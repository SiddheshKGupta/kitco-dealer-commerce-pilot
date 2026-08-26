import type { SupabaseClient } from "@supabase/supabase-js";
import { canOrderOffering } from "../src/domain/catalogue";
import type { HoldReason } from "../src/domain/holds";
import { retailValueMinor, validatePurchaseQuantities, type SizeQuantities } from "../src/domain/orders";
import { isAdminRole, type SessionIdentity } from "./middleware/auth";
import { ApiError } from "./middleware/errors";
import type {
  CatalogueRecord,
  CommerceRepository,
  DealerLocationRecord,
  DecideOrderLineV5Input,
  DraftLine,
  OrderAuditEvent,
  OrderPartnerSnapshot,
  OrderRecord,
  OrderReviewArticle,
  OrderReviewDetail,
  OrderVersionRecord,
  SubmitOrderInput,
} from "./repository";

type Row = Record<string, any>;

// The admin fulfilment RPCs (supabase/migrations/20260813184500_admin_fulfilment_rpc.sql,
// 20260815120000_partial_order_line_decisions.sql) raise real, specific Postgres error text
// for the cases an admin can actually hit and needs to know the reason for -- surface those
// verbatim as the ApiError message instead of collapsing every RPC failure to one generic
// string. Order matters: more specific patterns first.
const FULFILMENT_ERROR_PATTERNS: Array<[RegExp, string, string]> = [
  // v5 order review (decide_kitco_order_line_v5 / approve_entire_kitco_order / reject_entire_kitco_order,
  // supabase/migrations/20260824110000_v5_order_line_decisions.sql) -- specific patterns first.
  [/decision quantities cannot be negative/, "NEGATIVE_QUANTITY", "Decision quantities cannot be negative."],
  [/a credit review reason is required/, "CREDIT_REVIEW_REASON_REQUIRED", "A credit review reason is required when placing pairs under credit review."],
  [/a rejection reason is required/, "REJECTION_REASON_REQUIRED", "A rejection reason is required when rejecting pairs."],
  [/administrator access required/, "ADMIN_REQUIRED", "Administrator access is required."],
  [/order not found/, "ORDER_NOT_FOUND", "Order not found."],
  [/hold exceeds available pending quantity/, "HOLD_EXCEEDS_PENDING", "This hold would exceed the pairs still pending for this size."],
  [/dispatch exceeds available pending quantity/, "DISPATCH_EXCEEDS_PENDING", "This dispatch would exceed the pairs still pending for this size."],
  [/dealer location required when more than one active Ship-To exists/, "SHIP_TO_REQUIRED", "This dealer has more than one active Ship-To location -- choose one before dispatching."],
  [/active dealer Ship-To location not found/, "SHIP_TO_NOT_FOUND", "No active Ship-To location was found for this dealer."],
  [/approved plus held pairs cannot exceed/, "DECISION_EXCEEDS_ORDERED", "Approved plus held pairs can't exceed what the dealer ordered for this size."],
  [/approved pairs cannot drop below/, "APPROVED_BELOW_DISPATCHED", "Approved pairs can't drop below what's already been dispatched for this size."],
  [/order decisions are closed for status/, "ORDER_DECISIONS_CLOSED", "This order can no longer be decided."],
  [/hold reason required|a valid hold reason is required/, "HOLD_REASON_REQUIRED", "A hold reason is required when holding pairs."],
  [/approved order allocation not found|order line size not found/, "ALLOCATION_NOT_FOUND", "That order line and size could not be found."],
];

function fail(error: { message?: string } | null, code = "DATABASE_ERROR"): never {
  const message = error?.message ?? "";
  for (const [pattern, mappedCode, mappedMessage] of FULFILMENT_ERROR_PATTERNS) {
    if (pattern.test(message)) throw new ApiError(422, mappedCode, mappedMessage);
  }
  throw new ApiError(409, code, error?.message ? "The requested operation could not be completed" : "Database operation failed");
}

function one(value: unknown): Row | null {
  return Array.isArray(value) ? (value[0] as Row | undefined) ?? null : value && typeof value === "object" ? value as Row : null;
}

function dateOnly(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.slice(0, 10) : fallback;
}

/** Normalises source audience vocabulary (MEN/Men/MENS -> MEN) to the fixed vocabulary
 *  MEN | WOMEN | KIDS | UNISEX | UNKNOWN for display and filtering, without touching the
 *  raw imported value. Never returns null -- absent/unrecognised stays UNKNOWN (v4.0 §41).
 *  Handover §72. */
function normalizeGender(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "UNKNOWN";
  const upper = value.trim().toUpperCase();
  if (upper === "MEN" || upper === "MENS" || upper === "MALE") return "MEN";
  if (upper === "WOMEN" || upper === "WOMENS" || upper === "FEMALE") return "WOMEN";
  if (upper === "KID" || upper === "KIDS" || upper === "CHILD" || upper === "CHILDREN") return "KIDS";
  if (upper === "UNISEX") return "UNISEX";
  return "UNKNOWN";
}

function catalogueRow(row: Row): CatalogueRecord | null {
  const colourway = one(row.product_colourways);
  const family = one(colourway?.product_families);
  const brand = one(family?.brands);
  if (!colourway || !brand) return null;
  const sizes = (Array.isArray(colourway.product_size_values) ? colourway.product_size_values : [])
    .filter((item: Row) => item.enabled)
    .map((item: Row) => one(item.size_values))
    .filter((item): item is Row => item !== null)
    .sort((left: Row, right: Row) => Number(left.sort_order) - Number(right.sort_order))
    .map((item: Row) => String(item.label));
  const media = (Array.isArray(colourway.product_media) ? colourway.product_media : [])
    .filter((item: Row) => item.published_at && item.media_kind === "WEBP_600")[0] as Row | undefined;
  const stockPairs = (Array.isArray(colourway.stock_snapshot_lines) ? colourway.stock_snapshot_lines : [])
    .reduce((sum: number, item: Row) => sum + Math.max(0, Number(item.quantity_pairs) || 0), 0);
  return {
    organisationId: String(row.organisation_id),
    colourwayId: String(colourway.id),
    articleNo: String(colourway.article_no),
    brand: String(brand.name),
    familyId: family?.id ? String(family.id) : null,
    familyName: typeof family?.name === "string" ? family.name : null,
    category: typeof family?.category === "string" ? family.category : null,
    gender: normalizeGender(family?.gender),
    colour: typeof colourway.colour === "string" ? colourway.colour : "",
    mrpMinor: Number(row.mrp_minor),
    currencyCode: String(row.currency_code ?? "INR"),
    mediaKey: media?.object_key ? `${row.organisation_id}/${media.object_key}` : null,
    stockPairs: row.offering_type === "STOCK_IN_HAND" ? stockPairs : 1,
    offering: {
      id: String(row.id),
      enabledSizes: sizes,
      moqPairs: Number(row.moq_pairs),
      orderMultiplePairs: Number(row.order_multiple),
      active: Boolean(row.published_at),
      bookingOpensOn: dateOnly(row.opens_at, "0001-01-01"),
      bookingClosesOn: dateOnly(row.closes_at, "9999-12-31"),
      type: row.offering_type,
    },
  };
}

function versionFromRow(row: Row): OrderVersionRecord {
  const lines: DraftLine[] = (Array.isArray(row.order_lines) ? row.order_lines : []).map((line: Row) => ({
    offeringId: String(line.commercial_offering_id),
    quantities: Object.fromEntries((Array.isArray(line.order_line_sizes) ? line.order_line_sizes : []).map((size: Row) => [String(one(size.size_values)?.label ?? ""), Number(size.approved_quantity_pairs)])),
    retailValueMinor: Number(line.mrp_minor) * Number(line.approved_quantity_pairs),
  }));
  return {
    version: Number(row.version_no),
    status: row.version_status,
    retailValueMinor: Number(row.retail_value_minor),
    lines,
  };
}

function orderFromRow(row: Row): OrderRecord {
  const versions = (Array.isArray(row.order_versions) ? row.order_versions : []).sort((a: Row, b: Row) => Number(a.version_no) - Number(b.version_no)).map(versionFromRow);
  const latest = (Array.isArray(row.order_versions) ? row.order_versions : []).sort((a: Row, b: Row) => Number(b.version_no) - Number(a.version_no))[0] as Row | undefined;
  const allocations = latest ? (Array.isArray(latest.order_lines) ? latest.order_lines : []).flatMap((line: Row) => {
    const colourway = one(line.product_colourways);
    const family = colourway ? one(colourway.product_families) : null;
    const brand = family ? one(family.brands) : null;
    return (Array.isArray(line.order_line_sizes) ? line.order_line_sizes : []).map((size: Row) => {
      const dispatchedPairs = (Array.isArray(size.dispatch_lines) ? size.dispatch_lines : [])
        .filter((dispatch: Row) => one(dispatch.dispatches)?.status === "FINALISED")
        .reduce((sum: number, dispatch: Row) => sum + Number(dispatch.quantity_pairs), 0);
      const activeHolds = (Array.isArray(size.hold_allocations) ? size.hold_allocations : [])
        .filter((hold: Row) => one(hold.holds)?.status === "ACTIVE");
      const heldPairs = activeHolds.reduce((sum: number, hold: Row) => sum + Number(hold.quantity_pairs ?? 0), 0);
      const holdReason = activeHolds.length > 0 ? String(one(activeHolds[0]!.holds)?.hold_type ?? "") || undefined : undefined;
      return {
        orderLineId: String(line.id),
        size: String(one(size.size_values)?.label ?? ""),
        orderedPairs: Number(size.ordered_quantity_pairs),
        approvedPairs: Number(size.approved_quantity_pairs),
        dispatchedPairs,
        heldPairs,
        holdReason,
        articleNo: colourway?.article_no ? String(colourway.article_no) : undefined,
        colour: colourway?.colour ? String(colourway.colour) : undefined,
        familyName: family?.name ? String(family.name) : undefined,
        brand: brand?.name ? String(brand.name) : undefined,
      };
    });
  }) : [];
  const dealer = one(row.dealers);
  return {
    id: String(row.id), orderNumber: String(row.order_number), organisationId: String(row.organisation_id), dealerId: String(row.dealer_id),
    status: row.status, versions, allocations,
    dealerName: dealer?.name ? String(dealer.name) : undefined,
    dealerCity: dealer?.city ? String(dealer.city) : undefined,
    dealerState: dealer?.state ? String(dealer.state) : undefined,
    submittedAt: row.submitted_at ? String(row.submitted_at) : undefined,
    version: latest ? Number(latest.version_no) : undefined,
    retailValueMinor: latest ? Number(latest.retail_value_minor) : undefined,
  };
}

const ORDER_AUDIT_ACTIONS: Record<string, string> = {
  ORDER_SUBMITTED: "Order submitted",
  ORDER_APPROVED: "Order approved",
  ORDER_LINE_DECIDED: "Order line decided",
  CREDIT_HOLD_APPLIED: "Credit hold applied",
  DISPATCH_FINALISED: "Dispatch finalised",
};

/** Title-cases a SCREAMING_SNAKE_CASE enum for display, e.g. STOCK_REVIEW -> Stock review. */
function humanizeEnum(value: string): string {
  const words = value.replaceAll("_", " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** One-line plain-English paraphrase of an audit event's evidence, keyed by event_type. Unknown
 *  event types fall back to an empty detail -- the humanized action label alone still shows. */
function auditDetail(eventType: string, evidence: Row): string {
  switch (eventType) {
    case "ORDER_LINE_DECIDED": {
      const approved = Number(evidence.approved_pairs ?? 0);
      const held = Number(evidence.held_pairs ?? 0);
      const size = evidence.size ?? "?";
      if (held > 0) {
        const reason = evidence.hold_reason ? ` (${humanizeEnum(String(evidence.hold_reason))})` : "";
        return `Approved ${approved}, held ${held} of size ${size}${reason}`;
      }
      return `Approved ${approved} of size ${size}`;
    }
    case "CREDIT_HOLD_APPLIED":
      return `Held ${Number(evidence.pairs ?? 0)} pairs on credit hold`;
    case "DISPATCH_FINALISED":
      return `Dispatched ${Number(evidence.pairs ?? 0)} pairs`;
    case "ORDER_APPROVED":
      return "Order approved for fulfilment";
    case "ORDER_SUBMITTED":
      return `Submitted as version ${Number(evidence.version ?? 1)}`;
    default:
      return "";
  }
}

const ORDER_AUDIT_SELECT = "event_type,entity_id,correlation_id,evidence,occurred_at,actor_auth_user_id";

/** Order-related audit events don't share one entity_type/entity_id: ORDER_SUBMITTED and ORDER_APPROVED
 *  use entity_type='ORDER' with entity_id = the order id, while CREDIT_HOLD_APPLIED/ORDER_LINE_DECIDED/
 *  DISPATCH_FINALISED stash the order id inside evidence->>'order_id' instead (confirmed against
 *  supabase/migrations/20260815120000_partial_order_line_decisions.sql and 20260813184500_admin_fulfilment_rpc.sql).
 *  Matching on either covers every order-related event type currently written. Actor emails are
 *  batch-resolved once per call (same pattern as SupabaseAdminUsersStore.list / SupabaseAdminConsoleReader.audit)
 *  rather than N+1 per event. */
async function loadOrderAudit(client: SupabaseClient, organisationId: string, orderIds: string[]): Promise<Map<string, OrderAuditEvent[]>> {
  const byOrder = new Map<string, OrderAuditEvent[]>();
  if (orderIds.length === 0) return byOrder;
  const idList = orderIds.join(",");
  const { data, error } = await client.from("audit_events").select(ORDER_AUDIT_SELECT)
    .eq("organisation_id", organisationId)
    .or(`entity_id.in.(${idList}),evidence->>order_id.in.(${idList})`)
    .order("occurred_at", { ascending: true });
  if (error) fail(error, "ORDER_AUDIT_LOAD_FAILED");
  const rows = (data ?? []) as Row[];
  const actorIds = [...new Set(rows.map((row) => row.actor_auth_user_id).filter(Boolean))] as string[];
  const emailById = new Map<string, string>();
  await Promise.all(actorIds.map(async (id) => {
    const { data: user } = await client.auth.admin.getUserById(id);
    if (user.user?.email) emailById.set(id, user.user.email);
  }));
  for (const row of rows) {
    const evidence = (row.evidence ?? {}) as Row;
    const orderId = evidence.order_id ? String(evidence.order_id) : String(row.entity_id);
    const eventType = String(row.event_type);
    const entry: OrderAuditEvent = {
      correlationId: String(row.correlation_id),
      action: ORDER_AUDIT_ACTIONS[eventType] ?? humanizeEnum(eventType),
      detail: auditDetail(eventType, evidence),
      occurredAt: String(row.occurred_at),
      actorEmail: row.actor_auth_user_id ? emailById.get(String(row.actor_auth_user_id)) ?? "(unknown)" : "(unknown)",
    };
    const existing = byOrder.get(orderId);
    if (existing) existing.push(entry); else byOrder.set(orderId, [entry]);
  }
  return byOrder;
}

const CATALOGUE_SELECT = `
  id,organisation_id,offering_type,mrp_minor,currency_code,moq_pairs,order_multiple,opens_at,closes_at,published_at,
  product_colourways!inner(
    id,article_no,colour,published_at,
    product_families!inner(id,name,category,gender,brands!inner(name)),
    product_size_values(enabled,size_values(label,sort_order)),
    product_media(object_key,media_kind,published_at),
    stock_snapshot_lines(quantity_pairs)
  )`;

const ORDER_SELECT = `
  id,organisation_id,dealer_id,status,current_version_no,order_number,idempotency_key,submitted_at,
  dealers!dealer_id(name,city,state),
  order_versions(version_no,version_status,retail_value_minor,
    order_lines(id,commercial_offering_id,mrp_minor,approved_quantity_pairs,
      product_colourways!inner(article_no,colour,product_families(name,brands(name))),
      order_line_sizes(ordered_quantity_pairs,approved_quantity_pairs,size_values(label),
        dispatch_lines(quantity_pairs,dispatches(status)),hold_allocations(quantity_pairs,holds(status,hold_type)))))`;

// v5 Phase 5 order review: entirely separate from ORDER_SELECT/orderFromRow above (which the
// admin order list/table and dealer-facing routes still use unchanged) so this addition can't
// disturb that pipeline. Reads order_line_decisions -- the mutable, invariant-enforced table --
// rather than the legacy order_line_sizes.approved_quantity_pairs column the P0 fix replaced.
const ORDER_REVIEW_SELECT = `
  id,organisation_id,dealer_id,status,order_number,
  bill_to_snapshot,ship_to_snapshot,ordering_dealer_snapshot,
  dealer_po_number,delivery_preference,requested_delivery_date,estimated_delivery_date,
  order_versions(version_no,
    order_lines(id,
      product_colourways(article_no,colour,product_families(name,brands(name))),
      order_line_sizes(id,size_values(label),
        order_line_decisions(ordered_qty,approved_qty,credit_review_qty,rejected_qty,pending_qty,credit_review_reason,rejection_reason))))`;

function partnerSnapshot(value: unknown): OrderPartnerSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Row;
  return {
    dealerId: row.dealerId ? String(row.dealerId) : undefined,
    code: row.code ? String(row.code) : undefined,
    name: row.name ? String(row.name) : undefined,
    gstin: row.gstin ? String(row.gstin) : undefined,
    addressLine1: row.addressLine1 ? String(row.addressLine1) : undefined,
    city: row.city ? String(row.city) : undefined,
    state: row.state ? String(row.state) : undefined,
    pinCode: row.pinCode ? String(row.pinCode) : undefined,
  };
}

function orderReviewFromRow(row: Row): OrderReviewDetail {
  const versions = Array.isArray(row.order_versions) ? row.order_versions : [];
  const latest = versions.length > 0 ? versions.reduce((max: Row, version: Row) => Number(version.version_no) > Number(max.version_no) ? version : max) : null;
  const lines = latest && Array.isArray(latest.order_lines) ? latest.order_lines : [];
  const articles: OrderReviewArticle[] = (lines as Row[]).map((line: Row) => {
    const colourway = one(line.product_colourways);
    const family = colourway ? one(colourway.product_families) : null;
    const brand = family ? one(family.brands) : null;
    const sizes = (Array.isArray(line.order_line_sizes) ? line.order_line_sizes : []).map((sizeLine: Row) => {
      const decision = one(sizeLine.order_line_decisions);
      return {
        orderLineId: String(line.id),
        size: String(one(sizeLine.size_values)?.label ?? ""),
        orderedQty: Number(decision?.ordered_qty ?? 0),
        approvedQty: Number(decision?.approved_qty ?? 0),
        creditReviewQty: Number(decision?.credit_review_qty ?? 0),
        rejectedQty: Number(decision?.rejected_qty ?? 0),
        pendingQty: Number(decision?.pending_qty ?? 0),
        creditReviewReason: decision?.credit_review_reason ? String(decision.credit_review_reason) : null,
        rejectionReason: decision?.rejection_reason ? String(decision.rejection_reason) : null,
      };
    });
    return {
      orderLineId: String(line.id),
      articleNo: colourway?.article_no ? String(colourway.article_no) : undefined,
      colour: colourway?.colour ? String(colourway.colour) : undefined,
      familyName: family?.name ? String(family.name) : undefined,
      brand: brand?.name ? String(brand.name) : undefined,
      sizes,
    };
  });
  const totals = articles.flatMap((article) => article.sizes).reduce((sum, size) => ({
    ordered: sum.ordered + size.orderedQty, approved: sum.approved + size.approvedQty,
    creditReview: sum.creditReview + size.creditReviewQty, rejected: sum.rejected + size.rejectedQty, pending: sum.pending + size.pendingQty,
  }), { ordered: 0, approved: 0, creditReview: 0, rejected: 0, pending: 0 });
  return {
    id: String(row.id), orderNumber: String(row.order_number), status: String(row.status),
    orderingDealer: partnerSnapshot(row.ordering_dealer_snapshot), billTo: partnerSnapshot(row.bill_to_snapshot), shipTo: partnerSnapshot(row.ship_to_snapshot),
    dealerPoNumber: row.dealer_po_number ? String(row.dealer_po_number) : null,
    deliveryPreference: row.delivery_preference ? String(row.delivery_preference) : null,
    requestedDeliveryDate: row.requested_delivery_date ? String(row.requested_delivery_date) : null,
    estimatedDeliveryDate: row.estimated_delivery_date ? String(row.estimated_delivery_date) : null,
    articles, totals, audit: [],
  };
}

export class SupabaseCommerceRepository implements CommerceRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listCatalogue(session: SessionIdentity): Promise<CatalogueRecord[]> {
    const { data, error } = await this.client.from("commercial_offerings").select(CATALOGUE_SELECT)
      .eq("organisation_id", session.organisationId).not("published_at", "is", null);
    if (error) fail(error, "CATALOGUE_LOAD_FAILED");
    return (data as Row[]).map(catalogueRow).filter((item): item is CatalogueRecord => Boolean(item));
  }

  async findOffering(session: SessionIdentity, offeringId: string): Promise<CatalogueRecord | null> {
    const { data, error } = await this.client.from("commercial_offerings").select(CATALOGUE_SELECT)
      .eq("organisation_id", session.organisationId).eq("id", offeringId).not("published_at", "is", null).maybeSingle();
    if (error) fail(error, "OFFERING_LOAD_FAILED");
    return data ? catalogueRow(data as Row) : null;
  }

  async saveDraft(session: SessionIdentity, line: DraftLine, _correlationId: string): Promise<DraftLine[]> {
    if (!session.dealerId) throw new ApiError(403, "DEALER_REQUIRED", "Dealer access is required");
    const product = await this.findOffering(session, line.offeringId);
    if (!product) throw new ApiError(404, "OFFERING_NOT_FOUND", "Offering not found");
    const today = new Date().toISOString().slice(0, 10);
    if (!canOrderOffering(product.offering, today)) throw new ApiError(422, "OFFERING_CLOSED", "Offering is not open for ordering");
    const validation = validatePurchaseQuantities(product.offering, line.quantities);
    if (!validation.ok) throw new ApiError(422, validation.reason, "Purchase quantities are invalid");

    const { data: draft, error: draftError } = await this.client.from("draft_orders").upsert({
      organisation_id: session.organisationId, dealer_id: session.dealerId,
    }, { onConflict: "organisation_id,dealer_id" }).select("id").single();
    if (draftError || !draft) fail(draftError, "DRAFT_SAVE_FAILED");
    const { data: draftLine, error: lineError } = await this.client.from("draft_order_lines").upsert({
      organisation_id: session.organisationId, draft_order_id: draft.id, commercial_offering_id: line.offeringId,
    }, { onConflict: "draft_order_id,commercial_offering_id" }).select("id").single();
    if (lineError || !draftLine) fail(lineError, "DRAFT_SAVE_FAILED");

    const labels = Object.entries(line.quantities).filter(([, pairs]) => pairs > 0).map(([label]) => label);
    const { data: sizes, error: sizesError } = await this.client.from("product_size_values")
      .select("size_value_id,size_values!inner(label)")
      .eq("organisation_id", session.organisationId).eq("product_colourway_id", product.colourwayId)
      .eq("enabled", true).in("size_values.label", labels);
    if (sizesError || !sizes || sizes.length !== labels.length) fail(sizesError, "DRAFT_SIZE_RESOLUTION_FAILED");
    const { error: deleteError } = await this.client.from("draft_order_line_sizes").delete().eq("draft_order_line_id", draftLine.id);
    if (deleteError) fail(deleteError, "DRAFT_SAVE_FAILED");
    const rows = (sizes as Row[]).map((size) => {
      const label = String(one(size.size_values)?.label);
      return { organisation_id: session.organisationId, draft_order_line_id: draftLine.id, size_value_id: size.size_value_id, quantity_pairs: line.quantities[label] };
    });
    const { error: insertError } = await this.client.from("draft_order_line_sizes").insert(rows);
    if (insertError) fail(insertError, "DRAFT_SAVE_FAILED");
    return this.loadDraft(session, String(draft.id));
  }

  async findSubmittedOrderByIdempotency(session: SessionIdentity, idempotencyKey: string): Promise<OrderRecord | null> {
    if (!session.dealerId) return null;
    const { data, error } = await this.client.from("orders").select(ORDER_SELECT)
      .eq("organisation_id", session.organisationId).eq("dealer_id", session.dealerId).eq("idempotency_key", idempotencyKey).maybeSingle();
    if (error) fail(error, "ORDER_LOAD_FAILED");
    return data ? orderFromRow(data as Row) : null;
  }

  /** Phase 4: calls submit_kitco_order_v5, not the original submit_kitco_order (left
   *  untouched -- project convention since Phase 0 is a new versioned RPC alongside the
   *  old one, never an in-place edit). billTo/shipTo/location here are already proven
   *  by SupabaseDealerGroups.resolveOrderPartners in the route before this is called;
   *  the RPC still re-checks organisation_id on every partner row itself
   *  (defence in depth, V5_DEALER_GROUP_MODEL.md §4). */
  async submitOrder(session: SessionIdentity, input: SubmitOrderInput): Promise<{ created: boolean; order: OrderRecord }> {
    if (!session.dealerId) throw new ApiError(403, "DEALER_REQUIRED", "Dealer access is required");
    const { data, error } = await this.client.rpc("submit_kitco_order_v5", {
      p_organisation_id: session.organisationId,
      p_dealer_id: session.dealerId,
      p_actor_auth_user_id: session.userId,
      p_idempotency_key: input.idempotencyKey,
      p_otp_challenge_id: input.otpChallengeId,
      p_now: input.now,
      p_correlation_id: input.correlationId,
      p_bill_to_dealer_id: input.billToDealerId,
      p_ship_to_dealer_id: input.shipToDealerId,
      p_ship_to_location_id: input.shipToLocationId,
      p_dealer_po_number: input.dealerPoNumber,
      p_delivery_preference: input.deliveryPreference,
      p_requested_delivery_date: input.requestedDeliveryDate,
    });
    if (error || !data) fail(error, "ORDER_SUBMISSION_FAILED");
    const result = data as { order_id: string; created: boolean };
    const order = await this.findOrder(session, result.order_id);
    if (!order) throw new ApiError(409, "ORDER_SUBMISSION_FAILED", "The submitted order could not be loaded");
    return { created: Boolean(result.created), order };
  }

  async listOrders(session: SessionIdentity): Promise<OrderRecord[]> {
    let query = this.client.from("orders").select(ORDER_SELECT).eq("organisation_id", session.organisationId).order("submitted_at", { ascending: false });
    if (session.role === "DEALER") query = query.eq("dealer_id", session.dealerId);
    const { data, error } = await query;
    if (error) fail(error, "ORDER_LOAD_FAILED");
    const orders = (data as Row[]).map(orderFromRow);
    await this.attachAudit(session, orders);
    return orders;
  }

  async findOrder(session: SessionIdentity, orderId: string): Promise<OrderRecord | null> {
    let query = this.client.from("orders").select(ORDER_SELECT).eq("organisation_id", session.organisationId).eq("id", orderId);
    if (session.role === "DEALER") query = query.eq("dealer_id", session.dealerId);
    const { data, error } = await query.maybeSingle();
    if (error) fail(error, "ORDER_LOAD_FAILED");
    if (!data) return null;
    const order = orderFromRow(data as Row);
    await this.attachAudit(session, [order]);
    return order;
  }

  /** Admin-only: findOrder/listOrders are shared with the dealer-facing routes
   *  (worker/routes/orders.ts), which forward the whole OrderRecord to the dealer via
   *  a shallow spread. The audit trail carries KITCO staff emails and internal
   *  hold/decision detail that must never reach a dealer response. */
  private async attachAudit(session: SessionIdentity, orders: OrderRecord[]): Promise<void> {
    if (orders.length === 0 || !isAdminRole(session.role)) return;
    const audit = await loadOrderAudit(this.client, session.organisationId, orders.map((order) => order.id));
    for (const order of orders) order.audit = audit.get(order.id) ?? [];
  }

  async listDealerLocations(session: SessionIdentity): Promise<DealerLocationRecord[]> {
    if (!session.dealerId) throw new ApiError(403, "DEALER_REQUIRED", "Dealer access is required");
    const { data, error } = await this.client.from("dealer_locations").select("id,name,location_type")
      .eq("organisation_id", session.organisationId).eq("dealer_id", session.dealerId).eq("active", true).order("name");
    if (error) fail(error, "LOCATION_LOAD_FAILED");
    return (data as Row[]).map((row) => ({ id: String(row.id), name: String(row.name), locationType: row.location_type }));
  }

  async requestCancellation(session: SessionIdentity, orderId: string, reason: string, _correlationId: string) {
    const order = await this.findOrder(session, orderId);
    if (!order || !session.dealerId) throw new ApiError(404, "ORDER_NOT_FOUND", "Order not found");
    const { data, error } = await this.client.from("cancellation_requests").insert({ organisation_id: session.organisationId, dealer_id: session.dealerId, order_id: orderId, reason }).select("id,status").single();
    if (error || !data) fail(error, "CANCELLATION_FAILED");
    return { id: String(data.id), status: "PENDING" as const };
  }

  async approveOrder(session: SessionIdentity, orderId: string, correlationId: string): Promise<OrderRecord> {
    if (!isAdminRole(session.role)) throw new ApiError(403, "ADMIN_REQUIRED", "Administrator access is required");
    const { data, error } = await this.client.rpc("approve_kitco_order", {
      p_organisation_id: session.organisationId,
      p_actor_auth_user_id: session.userId,
      p_order_id: orderId,
      p_now: new Date().toISOString(),
      p_correlation_id: correlationId,
    });
    if (error || !data) fail(error, "ORDER_APPROVAL_FAILED");
    const order = await this.findOrder(session, String((data as { order_id: string }).order_id));
    if (!order) throw new ApiError(409, "ORDER_APPROVAL_FAILED", "The approved order could not be loaded");
    return order;
  }
  async reviseOrder(): Promise<OrderRecord> { throw new ApiError(409, "ADMIN_MUTATION_UNAVAILABLE", "Admin mutations are disabled until the audited database function is installed"); }
  async applyHold(session: SessionIdentity, input: { orderId: string; orderLineId: string; size: string; pairs: number; reason: string }, correlationId: string): Promise<void> {
    if (!isAdminRole(session.role)) throw new ApiError(403, "ADMIN_REQUIRED", "Administrator access is required");
    const { data, error } = await this.client.rpc("apply_kitco_credit_hold", {
      p_organisation_id: session.organisationId,
      p_actor_auth_user_id: session.userId,
      p_order_id: input.orderId,
      p_order_line_id: input.orderLineId,
      p_size_label: input.size,
      p_pairs: input.pairs,
      p_reason: input.reason,
      p_now: new Date().toISOString(),
      p_correlation_id: correlationId,
    });
    if (error || !data) fail(error, "HOLD_FAILED");
  }
  async decideOrderLine(session: SessionIdentity, input: { orderId: string; orderLineId: string; size: string; approvedPairs: number; heldPairs: number; holdReason: HoldReason | null }, correlationId: string): Promise<OrderRecord> {
    if (!isAdminRole(session.role)) throw new ApiError(403, "ADMIN_REQUIRED", "Administrator access is required");
    const { data, error } = await this.client.rpc("decide_kitco_order_line", {
      p_organisation_id: session.organisationId,
      p_actor_auth_user_id: session.userId,
      p_order_id: input.orderId,
      p_order_line_id: input.orderLineId,
      p_size_label: input.size,
      p_approved_pairs: input.approvedPairs,
      p_held_pairs: input.heldPairs,
      p_hold_reason: input.holdReason,
      p_now: new Date().toISOString(),
      p_correlation_id: correlationId,
    });
    if (error || !data) fail(error, "ORDER_LINE_DECISION_FAILED");
    const order = await this.findOrder(session, input.orderId);
    if (!order) throw new ApiError(409, "ORDER_LINE_DECISION_FAILED", "The decided order could not be loaded");
    return order;
  }
  async createDispatch(session: SessionIdentity, input: { orderId: string; orderLineId: string; size: string; pairs: number; dealerLocationId?: string }, correlationId: string): Promise<OrderRecord> {
    if (!isAdminRole(session.role)) throw new ApiError(403, "ADMIN_REQUIRED", "Administrator access is required");
    const { data, error } = await this.client.rpc("create_kitco_dispatch", {
      p_organisation_id: session.organisationId,
      p_actor_auth_user_id: session.userId,
      p_order_id: input.orderId,
      p_order_line_id: input.orderLineId,
      p_size_label: input.size,
      p_pairs: input.pairs,
      p_dealer_location_id: input.dealerLocationId ?? null,
      p_now: new Date().toISOString(),
      p_correlation_id: correlationId,
    });
    if (error || !data) fail(error, "DISPATCH_FAILED");
    const order = await this.findOrder(session, input.orderId);
    if (!order) throw new ApiError(409, "DISPATCH_FAILED", "The dispatched order could not be loaded");
    return order;
  }
  async stageImport(): Promise<{ id: string; status: "UPLOADED" }> { throw new ApiError(409, "IMPORT_COMMIT_UNAVAILABLE", "Import commit is disabled until a staged source file is ready"); }

  /** v5 Phase 5 order review, admin-only. Self-scopes on organisation_id like every other
   *  query here; the RPCs additionally re-check organisation_id server-side (defence in depth
   *  against a client-supplied orderId that doesn't belong to the caller's organisation). */
  async getOrderReview(session: SessionIdentity, orderId: string): Promise<OrderReviewDetail | null> {
    if (!isAdminRole(session.role)) throw new ApiError(403, "ADMIN_REQUIRED", "Administrator access is required");
    const { data, error } = await this.client.from("orders").select(ORDER_REVIEW_SELECT)
      .eq("organisation_id", session.organisationId).eq("id", orderId).maybeSingle();
    if (error) fail(error, "ORDER_LOAD_FAILED");
    if (!data) return null;
    const review = orderReviewFromRow(data as Row);
    const audit = await loadOrderAudit(this.client, session.organisationId, [review.id]);
    review.audit = audit.get(review.id) ?? [];
    return review;
  }

  async decideOrderLineV5(session: SessionIdentity, input: DecideOrderLineV5Input, correlationId: string): Promise<OrderReviewDetail> {
    if (!isAdminRole(session.role)) throw new ApiError(403, "ADMIN_REQUIRED", "Administrator access is required");
    const { data, error } = await this.client.rpc("decide_kitco_order_line_v5", {
      p_organisation_id: session.organisationId,
      p_actor_auth_user_id: session.userId,
      p_order_id: input.orderId,
      p_order_line_id: input.orderLineId,
      p_size_label: input.size,
      p_approved_qty: input.approvedQty,
      p_credit_review_qty: input.creditReviewQty,
      p_rejected_qty: input.rejectedQty,
      p_credit_review_reason: input.creditReviewReason,
      p_rejection_reason: input.rejectionReason,
      p_now: new Date().toISOString(),
      p_correlation_id: correlationId,
    });
    if (error || !data) fail(error, "ORDER_LINE_DECISION_FAILED");
    const review = await this.getOrderReview(session, input.orderId);
    if (!review) throw new ApiError(409, "ORDER_LINE_DECISION_FAILED", "The decided order could not be loaded");
    return review;
  }

  async approveEntireOrder(session: SessionIdentity, orderId: string, correlationId: string): Promise<OrderReviewDetail> {
    if (!isAdminRole(session.role)) throw new ApiError(403, "ADMIN_REQUIRED", "Administrator access is required");
    const { data, error } = await this.client.rpc("approve_entire_kitco_order", {
      p_organisation_id: session.organisationId,
      p_actor_auth_user_id: session.userId,
      p_order_id: orderId,
      p_now: new Date().toISOString(),
      p_correlation_id: correlationId,
    });
    if (error || !data) fail(error, "ORDER_APPROVAL_FAILED");
    const review = await this.getOrderReview(session, orderId);
    if (!review) throw new ApiError(409, "ORDER_APPROVAL_FAILED", "The approved order could not be loaded");
    return review;
  }

  async rejectEntireOrder(session: SessionIdentity, orderId: string, reason: string, correlationId: string): Promise<OrderReviewDetail> {
    if (!isAdminRole(session.role)) throw new ApiError(403, "ADMIN_REQUIRED", "Administrator access is required");
    const { data, error } = await this.client.rpc("reject_entire_kitco_order", {
      p_organisation_id: session.organisationId,
      p_actor_auth_user_id: session.userId,
      p_order_id: orderId,
      p_reason: reason,
      p_now: new Date().toISOString(),
      p_correlation_id: correlationId,
    });
    if (error || !data) fail(error, "ORDER_REJECTION_FAILED");
    const review = await this.getOrderReview(session, orderId);
    if (!review) throw new ApiError(409, "ORDER_REJECTION_FAILED", "The rejected order could not be loaded");
    return review;
  }

  async getDraft(session: SessionIdentity): Promise<DraftLine[]> {
    if (!session.dealerId) throw new ApiError(403, "DEALER_REQUIRED", "Dealer access is required");
    const draftId = await this.currentDraftId(session);
    if (!draftId) return [];
    return this.loadDraft(session, draftId);
  }

  async removeDraftLine(session: SessionIdentity, offeringId: string, _correlationId: string): Promise<DraftLine[]> {
    if (!session.dealerId) throw new ApiError(403, "DEALER_REQUIRED", "Dealer access is required");
    const draftId = await this.currentDraftId(session);
    if (!draftId) return [];
    const { error } = await this.client.from("draft_order_lines").delete()
      .eq("organisation_id", session.organisationId).eq("draft_order_id", draftId).eq("commercial_offering_id", offeringId);
    if (error) fail(error, "DRAFT_LINE_REMOVE_FAILED");
    return this.loadDraft(session, draftId);
  }

  private async currentDraftId(session: SessionIdentity): Promise<string | null> {
    const { data, error } = await this.client.from("draft_orders").select("id")
      .eq("organisation_id", session.organisationId).eq("dealer_id", session.dealerId).maybeSingle();
    if (error) fail(error, "DRAFT_LOAD_FAILED");
    return data ? String(data.id) : null;
  }

  private async loadDraft(session: SessionIdentity, draftId: string): Promise<DraftLine[]> {
    const { data, error } = await this.client.from("draft_order_lines").select(`commercial_offering_id,
      commercial_offerings(mrp_minor,currency_code,
        product_colourways!inner(article_no,colour,product_media(object_key,media_kind,published_at),product_families(name,brands!inner(name)))),
      draft_order_line_sizes(quantity_pairs,size_values(label,size_sets(size_systems(label))))`)
      .eq("organisation_id", session.organisationId).eq("draft_order_id", draftId);
    if (error) fail(error, "DRAFT_LOAD_FAILED");
    return (data as Row[]).map((row) => {
      const sizeRows = row.draft_order_line_sizes as Row[];
      const quantities: SizeQuantities = Object.fromEntries(sizeRows.map((size) => [String(one(size.size_values)?.label), Number(size.quantity_pairs)]));
      // Size System is never optional (V5_PRODUCT_SPEC.md §4) -- every size in a line comes
      // from the same colourway's size_set, so the first row's system speaks for the line.
      // size_system_id is unpopulated on every size_set today (the migration only added the
      // column); a null here degrades to "not confirmed" in the UI rather than blocking checkout.
      const sizeSet = sizeRows.length > 0 ? one(one(sizeRows[0]!.size_values)?.size_sets) : null;
      const sizeSystemLabel = sizeSet ? one(sizeSet.size_systems)?.label ?? null : null;
      const offering = one(row.commercial_offerings);
      const colourway = offering ? one(offering.product_colourways) : null;
      const family = colourway ? one(colourway.product_families) : null;
      const brand = family ? one(family.brands) : null;
      const mrp = Number(offering?.mrp_minor);
      const media = (Array.isArray(colourway?.product_media) ? colourway.product_media : [])
        .find((item: Row) => item.published_at && item.media_kind === "WEBP_600") as Row | undefined;
      return {
        offeringId: String(row.commercial_offering_id), quantities, retailValueMinor: retailValueMinor(mrp, quantities),
        articleNo: colourway?.article_no ? String(colourway.article_no) : undefined,
        colour: colourway?.colour ? String(colourway.colour) : undefined,
        familyName: family?.name ? String(family.name) : undefined,
        brand: brand?.name ? String(brand.name) : undefined,
        mrpMinor: Number.isFinite(mrp) ? mrp : undefined,
        currencyCode: offering?.currency_code ? String(offering.currency_code) : undefined,
        mediaKey: media?.object_key ? `${session.organisationId}/${media.object_key}` : null,
        sizeSystemLabel: sizeSystemLabel ? String(sizeSystemLabel) : null,
      };
    });
  }
}

export class R2CatalogueMediaStore {
  constructor(private readonly bucket: R2Bucket) {}
  async get(scopedKey: string) {
    const separator = scopedKey.indexOf("/");
    if (separator < 1) return null;
    const object = await this.bucket.get(scopedKey.slice(separator + 1));
    if (!object?.body) return null;
    return { body: object.body, contentType: object.httpMetadata?.contentType ?? "application/octet-stream" };
  }
  /** Mirrors get()'s key handling exactly: the organisation prefix is a routing
   *  guard carried in the scoped key, not part of the stored object key. The two
   *  must strip it identically or an uploaded object becomes unreadable. */
  async put(scopedKey: string, body: ArrayBuffer, contentType: string) {
    const separator = scopedKey.indexOf("/");
    if (separator < 1) throw new ApiError(400, "INVALID_MEDIA_KEY", "Invalid media key");
    await this.bucket.put(scopedKey.slice(separator + 1), body, { httpMetadata: { contentType } });
  }
}
