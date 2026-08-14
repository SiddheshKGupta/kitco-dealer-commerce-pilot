import type { SupabaseClient } from "@supabase/supabase-js";
import { canOrderOffering } from "../src/domain/catalogue";
import { retailValueMinor, validatePurchaseQuantities, type SizeQuantities } from "../src/domain/orders";
import { isAdminRole, type SessionIdentity } from "./middleware/auth";
import { ApiError } from "./middleware/errors";
import type {
  CatalogueRecord,
  CommerceRepository,
  DealerLocationRecord,
  DraftLine,
  OrderRecord,
  OrderVersionRecord,
} from "./repository";

type Row = Record<string, any>;

function fail(error: { message?: string } | null, code = "DATABASE_ERROR"): never {
  throw new ApiError(409, code, error?.message ? "The requested operation could not be completed" : "Database operation failed");
}

function one(value: unknown): Row | null {
  return Array.isArray(value) ? (value[0] as Row | undefined) ?? null : value && typeof value === "object" ? value as Row : null;
}

function dateOnly(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.slice(0, 10) : fallback;
}

/** Normalises source audience vocabulary (MEN/Men/MENS -> MEN) for display and filtering
 *  without touching the raw imported value. Handover §72. */
function normalizeGender(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const upper = value.trim().toUpperCase();
  if (upper === "MEN" || upper === "MENS") return "MEN";
  if (upper === "WOMEN" || upper === "WOMENS") return "WOMEN";
  return upper;
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
      const heldPairs = (Array.isArray(size.hold_allocations) ? size.hold_allocations : [])
        .filter((hold: Row) => one(hold.holds)?.status === "ACTIVE")
        .reduce((sum: number, hold: Row) => sum + Number(hold.quantity_pairs ?? 0), 0);
      return {
        orderLineId: String(line.id),
        size: String(one(size.size_values)?.label ?? ""),
        approvedPairs: Number(size.approved_quantity_pairs),
        dispatchedPairs,
        heldPairs,
        articleNo: colourway?.article_no ? String(colourway.article_no) : undefined,
        colour: colourway?.colour ? String(colourway.colour) : undefined,
        familyName: family?.name ? String(family.name) : undefined,
        brand: brand?.name ? String(brand.name) : undefined,
      };
    });
  }) : [];
  return {
    id: String(row.id), orderNumber: String(row.order_number), organisationId: String(row.organisation_id), dealerId: String(row.dealer_id),
    status: row.status, versions, allocations,
  };
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
  id,organisation_id,dealer_id,status,current_version_no,order_number,idempotency_key,
  order_versions(version_no,version_status,retail_value_minor,
    order_lines(id,commercial_offering_id,mrp_minor,approved_quantity_pairs,
      product_colourways!inner(article_no,colour,product_families(name,brands(name))),
      order_line_sizes(ordered_quantity_pairs,approved_quantity_pairs,size_values(label),
        dispatch_lines(quantity_pairs,dispatches(status)),hold_allocations(quantity_pairs,holds(status)))))`;

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

  async submitOrder(session: SessionIdentity, input: { idempotencyKey: string; otpChallengeId: string; now: string; correlationId: string }): Promise<{ created: boolean; order: OrderRecord }> {
    if (!session.dealerId) throw new ApiError(403, "DEALER_REQUIRED", "Dealer access is required");
    const { data, error } = await this.client.rpc("submit_kitco_order", {
      p_organisation_id: session.organisationId,
      p_dealer_id: session.dealerId,
      p_actor_auth_user_id: session.userId,
      p_idempotency_key: input.idempotencyKey,
      p_otp_challenge_id: input.otpChallengeId,
      p_now: input.now,
      p_correlation_id: input.correlationId,
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
    return (data as Row[]).map(orderFromRow);
  }

  async findOrder(session: SessionIdentity, orderId: string): Promise<OrderRecord | null> {
    let query = this.client.from("orders").select(ORDER_SELECT).eq("organisation_id", session.organisationId).eq("id", orderId);
    if (session.role === "DEALER") query = query.eq("dealer_id", session.dealerId);
    const { data, error } = await query.maybeSingle();
    if (error) fail(error, "ORDER_LOAD_FAILED");
    return data ? orderFromRow(data as Row) : null;
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
  async createDispatch(session: SessionIdentity, input: { orderId: string; orderLineId: string; size: string; pairs: number; dealerLocationId?: string }, correlationId: string): Promise<void> {
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
  }
  async stageImport(): Promise<{ id: string; status: "UPLOADED" }> { throw new ApiError(409, "IMPORT_COMMIT_UNAVAILABLE", "Import commit is disabled until a staged source file is ready"); }

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
      draft_order_line_sizes(quantity_pairs,size_values(label))`)
      .eq("organisation_id", session.organisationId).eq("draft_order_id", draftId);
    if (error) fail(error, "DRAFT_LOAD_FAILED");
    return (data as Row[]).map((row) => {
      const quantities: SizeQuantities = Object.fromEntries((row.draft_order_line_sizes as Row[]).map((size) => [String(one(size.size_values)?.label), Number(size.quantity_pairs)]));
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
}
