import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionIdentity } from "./middleware/auth";
import { ApiError } from "./middleware/errors";
import { syncMainDealer } from "./sync-main-dealer";
import type {
  AdminDealerGroupRow,
  AdminGstRegistrationRow,
  AdminMembershipRequestRow,
  DealerGroupPayload,
  DealerGroupsStore,
  GroupDealerRow,
  MembershipRequestRow,
  OrderPartnerSelection,
  ResolvedOrderPartners,
} from "./routes/dealer-groups";

type Row = Record<string, any>;

const SHIP_TO_LOCATION_TYPES = ["SHIP_TO", "BOTH"];

/** A dealer is selectable as a partner when it is ACTIVE. account_state is the v5
 *  machine but is nullable until the cutover backfill, so a dealer that has not been
 *  moved onto it yet is judged by v4's activation_status -- the same column the session
 *  verifier already gates login on. Explicit SUSPENDED/DISABLED therefore always loses. */
function isSelectableDealer(row: Row | undefined): boolean {
  if (!row) return false;
  return row.account_state ? row.account_state === "ACTIVE" : row.activation_status === "ACTIVE";
}

export class SupabaseDealerGroups implements DealerGroupsStore {
  constructor(private readonly client: SupabaseClient) {}

  private async audit(
    session: SessionIdentity,
    correlationId: string,
    eventType: string,
    entityType: string,
    entityId: string,
    evidence: Record<string, unknown>,
    dealerId: string | null = null,
  ) {
    await this.client.from("audit_events").insert({
      organisation_id: session.organisationId,
      dealer_id: dealerId,
      actor_auth_user_id: session.userId,
      event_type: eventType,
      entity_type: entityType,
      entity_id: entityId,
      correlation_id: correlationId,
      evidence,
    });
  }

  private sessionDealerId(session: SessionIdentity): string {
    if (session.role !== "DEALER" || !session.dealerId) throw new ApiError(403, "DEALER_REQUIRED", "Dealer access is required");
    return session.dealerId;
  }

  /** Every dealer read in this file goes through here so the organisation filter can
   *  never be forgotten on one branch: the Worker holds the service-role key and
   *  bypasses RLS, so this filter is the only thing standing between tenants. */
  private async loadDealers(organisationId: string, dealerIds: string[]): Promise<Map<string, Row>> {
    if (dealerIds.length === 0) return new Map();
    const { data, error } = await this.client
      .from("dealers")
      .select("id,code,name,display_name,city,state,dealer_group_id,gst_registration_id,is_main_dealer,account_state,activation_status")
      .eq("organisation_id", organisationId)
      .in("id", dealerIds);
    if (error) throw new ApiError(502, "DEALER_GROUP_LOAD_FAILED", "Dealer group could not be loaded");
    return new Map((data as Row[] ?? []).map((row) => [String(row.id), row]));
  }

  private async loadActiveGroup(organisationId: string, groupId: string): Promise<Row | null> {
    const { data, error } = await this.client
      .from("dealer_groups")
      .select("id,group_code,group_name,status,primary_dealer_id")
      .eq("id", groupId)
      .eq("organisation_id", organisationId)
      .maybeSingle();
    if (error) throw new ApiError(502, "DEALER_GROUP_LOAD_FAILED", "Dealer group could not be loaded");
    return (data as Row | null) ?? null;
  }

  async groupForDealer(session: SessionIdentity): Promise<DealerGroupPayload> {
    const org = session.organisationId;
    const dealerId = this.sessionDealerId(session);
    const self = (await this.loadDealers(org, [dealerId])).get(dealerId);
    if (!self) throw new ApiError(403, "DEALER_NOT_FOUND", "Dealer access is required");

    const group = self.dealer_group_id ? await this.loadActiveGroup(org, String(self.dealer_group_id)) : null;
    // A SUSPENDED group withdraws exactly one privilege -- naming a sibling. The dealer
    // keeps ordering for itself, so it is still listed as its own Bill-To/Ship-To.
    const siblingsAllowed = group !== null && group.status === "ACTIVE";

    let dealerRows: Row[] = [self];
    if (siblingsAllowed) {
      const { data, error } = await this.client
        .from("dealers")
        .select("id,code,name,display_name,city,state,dealer_group_id,gst_registration_id,is_main_dealer,account_state,activation_status")
        .eq("organisation_id", org)
        .eq("dealer_group_id", group.id)
        .order("code");
      if (error) throw new ApiError(502, "DEALER_GROUP_LOAD_FAILED", "Dealer group could not be loaded");
      dealerRows = (data as Row[] ?? []).filter((row) => String(row.id) === dealerId || isSelectableDealer(row));
      if (!dealerRows.some((row) => String(row.id) === dealerId)) dealerRows = [self, ...dealerRows];
    }

    const dealerIds = dealerRows.map((row) => String(row.id));
    const registrationIds = [...new Set(dealerRows.map((row) => row.gst_registration_id).filter(Boolean).map(String))];
    const [locations, registrations] = await Promise.all([
      this.client.from("dealer_locations").select("id,dealer_id,name,location_type,address")
        .eq("organisation_id", org).in("dealer_id", dealerIds).eq("active", true).in("location_type", SHIP_TO_LOCATION_TYPES),
      registrationIds.length > 0
        ? this.client.from("gst_registrations").select("id,gstin").eq("organisation_id", org).in("id", registrationIds)
        : Promise.resolve({ data: [] as Row[], error: null }),
    ]);
    if (locations.error || registrations.error) throw new ApiError(502, "DEALER_GROUP_LOAD_FAILED", "Dealer group could not be loaded");
    const gstinById = new Map((registrations.data as Row[] ?? []).map((row) => [String(row.id), String(row.gstin)]));

    const dealers: GroupDealerRow[] = dealerRows.map((row) => ({
      dealerId: String(row.id),
      dealerCode: String(row.code),
      displayName: String(row.display_name ?? row.name),
      gstin: row.gst_registration_id ? gstinById.get(String(row.gst_registration_id)) ?? null : null,
      city: row.city ? String(row.city) : null,
      state: row.state ? String(row.state) : null,
      isSelf: String(row.id) === dealerId,
      isMainDealer: row.is_main_dealer === true,
      locations: (locations.data as Row[] ?? [])
        .filter((location) => String(location.dealer_id) === String(row.id))
        .map((location) => ({
          id: String(location.id),
          name: String(location.name),
          locationType: String(location.location_type),
          address: (location.address ?? {}) as Record<string, unknown>,
        })),
    }));

    return {
      group: group ? { id: String(group.id), groupCode: String(group.group_code), groupName: String(group.group_name), status: String(group.status) } : null,
      dealers,
    };
  }

  async listOwnRequests(session: SessionIdentity): Promise<MembershipRequestRow[]> {
    const dealerId = this.sessionDealerId(session);
    const { data, error } = await this.client
      .from("dealer_group_membership_requests")
      .select("id,requested_group_code,status,requested_at,decided_at,decision_notes")
      .eq("organisation_id", session.organisationId)
      .eq("dealer_id", dealerId)
      .order("requested_at", { ascending: false });
    if (error) throw new ApiError(502, "MEMBERSHIP_REQUEST_LOAD_FAILED", "Membership requests could not be loaded");
    return (data as Row[] ?? []).map(toMembershipRequestRow);
  }

  /** The response is byte-identical whether or not the quoted code matches a real
   *  group: the code is resolved server-side into resolved_group_id for the admin
   *  queue, and nothing about that resolution reaches the dealer (v5 §3). A group
   *  code must not become a probe for which groups exist. */
  async requestMembership(session: SessionIdentity, groupCode: string, correlationId: string): Promise<MembershipRequestRow> {
    const org = session.organisationId;
    const dealerId = this.sessionDealerId(session);
    const self = (await this.loadDealers(org, [dealerId])).get(dealerId);
    if (!self) throw new ApiError(403, "DEALER_NOT_FOUND", "Dealer access is required");
    if (self.dealer_group_id) throw new ApiError(409, "ALREADY_IN_GROUP", "Your dealer already belongs to a group");

    const { data: pending, error: pendingError } = await this.client
      .from("dealer_group_membership_requests").select("id")
      .eq("organisation_id", org).eq("dealer_id", dealerId).eq("status", "PENDING").maybeSingle();
    if (pendingError) throw new ApiError(502, "MEMBERSHIP_REQUEST_LOAD_FAILED", "Membership requests could not be loaded");
    if (pending) throw new ApiError(409, "REQUEST_ALREADY_PENDING", "You already have a group request awaiting review");

    const { data: match, error: matchError } = await this.client
      .from("dealer_groups").select("id").eq("organisation_id", org).eq("group_code", groupCode).maybeSingle();
    if (matchError) throw new ApiError(502, "MEMBERSHIP_REQUEST_FAILED", "Your request could not be submitted");

    const { data, error } = await this.client.from("dealer_group_membership_requests").insert({
      organisation_id: org,
      dealer_id: dealerId,
      requested_group_code: groupCode,
      resolved_group_id: match ? String(match.id) : null,
      status: "PENDING",
    }).select("id,requested_group_code,status,requested_at,decided_at,decision_notes").single();
    if (error) {
      if (error.code === "23505") throw new ApiError(409, "REQUEST_ALREADY_PENDING", "You already have a group request awaiting review");
      throw new ApiError(502, "MEMBERSHIP_REQUEST_FAILED", "Your request could not be submitted");
    }

    await this.audit(session, correlationId, "DEALER_GROUP_MEMBERSHIP_REQUESTED", "dealer_group_membership_request", String(data.id), { requestedGroupCode: groupCode }, dealerId);
    return toMembershipRequestRow(data as Row);
  }

  async listGroups(session: SessionIdentity): Promise<AdminDealerGroupRow[]> {
    const org = session.organisationId;
    const [groups, dealers] = await Promise.all([
      this.client.from("dealer_groups").select("id,group_code,group_name,status,primary_dealer_id").eq("organisation_id", org).order("group_code"),
      this.client.from("dealers").select("id,dealer_group_id").eq("organisation_id", org),
    ]);
    if (groups.error || dealers.error) throw new ApiError(502, "DEALER_GROUP_LOAD_FAILED", "Dealer groups could not be loaded");
    const counts = (dealers.data as Row[] ?? []).reduce<Record<string, number>>((acc, row) => {
      if (!row.dealer_group_id) return acc;
      const key = String(row.dealer_group_id);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    return (groups.data as Row[] ?? []).map((row) => ({
      id: String(row.id),
      groupCode: String(row.group_code),
      groupName: String(row.group_name),
      status: String(row.status),
      primaryDealerId: row.primary_dealer_id ? String(row.primary_dealer_id) : null,
      dealerCount: counts[String(row.id)] ?? 0,
    }));
  }

  async createGroup(session: SessionIdentity, groupCode: string, groupName: string, correlationId: string): Promise<{ id: string }> {
    const { data, error } = await this.client.from("dealer_groups")
      .insert({ organisation_id: session.organisationId, group_code: groupCode, group_name: groupName })
      .select("id").single();
    if (error) {
      if (error.code === "23505") throw new ApiError(409, "GROUP_CODE_TAKEN", "A group with this code already exists");
      throw new ApiError(502, "DEALER_GROUP_CREATE_FAILED", "Dealer group could not be created");
    }
    await this.audit(session, correlationId, "DEALER_GROUP_CREATED", "dealer_group", String(data.id), { groupCode, groupName });
    return { id: String(data.id) };
  }

  async renameGroup(session: SessionIdentity, groupId: string, groupName: string, correlationId: string): Promise<void> {
    const org = session.organisationId;
    const group = await this.loadActiveGroup(org, groupId);
    if (!group) throw new ApiError(404, "DEALER_GROUP_NOT_FOUND", "Dealer group not found");
    // Read off the row before the write: the whole point of the audit line is the old
    // name, and re-reading `group` afterwards is one aliasing bug away from logging the
    // new name as if it were the old one.
    const { group_code: groupCode, group_name: previousName } = group;
    const { error } = await this.client.from("dealer_groups").update({ group_name: groupName })
      .eq("id", groupId).eq("organisation_id", org);
    if (error) throw new ApiError(502, "DEALER_GROUP_RENAME_FAILED", "Dealer group could not be renamed");
    await this.audit(session, correlationId, "DEALER_GROUP_RENAMED", "dealer_group", groupId, {
      groupCode: String(groupCode), from: String(previousName), to: groupName,
    });
  }

  /** Registrations with the dealers trading under each. Both reads are organisation
   *  scoped; the join is done here rather than in PostgREST so a dealer row can never
   *  arrive through a registration's embedded resource and skip that filter. */
  async listGstRegistrations(session: SessionIdentity): Promise<AdminGstRegistrationRow[]> {
    const org = session.organisationId;
    const [registrations, dealers] = await Promise.all([
      this.client.from("gst_registrations")
        .select("id,gstin,legal_name,trade_name,state,gst_status,verification_status,verified_at,provider")
        .eq("organisation_id", org).order("gstin"),
      this.client.from("dealers").select("id,code,name,display_name,city,state,gst_registration_id,is_main_dealer")
        .eq("organisation_id", org).order("code"),
    ]);
    if (registrations.error || dealers.error) throw new ApiError(502, "GST_REGISTRATION_LOAD_FAILED", "GST registrations could not be loaded");

    const byRegistration = new Map<string, AdminGstRegistrationRow["dealers"]>();
    for (const row of (dealers.data as Row[]) ?? []) {
      if (!row.gst_registration_id) continue;
      const key = String(row.gst_registration_id);
      const list = byRegistration.get(key) ?? [];
      list.push({
        dealerId: String(row.id),
        dealerCode: String(row.code),
        displayName: String(row.display_name ?? row.name),
        city: row.city ? String(row.city) : null,
        state: row.state ? String(row.state) : null,
        isMainDealer: row.is_main_dealer === true,
      });
      byRegistration.set(key, list);
    }

    return ((registrations.data as Row[]) ?? []).map((row) => ({
      id: String(row.id),
      gstin: String(row.gstin),
      legalName: row.legal_name ? String(row.legal_name) : null,
      tradeName: row.trade_name ? String(row.trade_name) : null,
      state: row.state ? String(row.state) : null,
      gstStatus: row.gst_status ? String(row.gst_status) : null,
      // A null column means nobody has ever attempted verification, which is exactly
      // what UNVERIFIED says. Never upgraded to anything stronger here.
      verificationStatus: row.verification_status ? String(row.verification_status) : "UNVERIFIED",
      verifiedAt: row.verified_at ? String(row.verified_at) : null,
      provider: row.provider ? String(row.provider) : null,
      dealers: byRegistration.get(String(row.id)) ?? [],
    }));
  }

  async assignDealer(session: SessionIdentity, groupId: string, dealerCode: string, isMainDealer: boolean, correlationId: string): Promise<{ dealerId: string }> {
    const org = session.organisationId;
    const group = await this.loadActiveGroup(org, groupId);
    if (!group) throw new ApiError(404, "DEALER_GROUP_NOT_FOUND", "Dealer group not found");

    const { data: dealer, error: dealerError } = await this.client.from("dealers")
      .select("id,code,dealer_group_id").eq("organisation_id", org).eq("code", dealerCode).maybeSingle();
    if (dealerError) throw new ApiError(502, "DEALER_GROUP_ASSIGN_FAILED", "Dealer could not be loaded");
    if (!dealer) throw new ApiError(404, "DEALER_NOT_FOUND", "No dealer with this code exists");
    const dealerId = String(dealer.id);

    const { error } = await this.client.from("dealers")
      .update({ dealer_group_id: groupId, is_main_dealer: isMainDealer }).eq("id", dealerId).eq("organisation_id", org);
    if (error) throw new ApiError(502, "DEALER_GROUP_ASSIGN_FAILED", "Dealer could not be assigned to the group");

    if (isMainDealer) await syncMainDealer(this.client, org, groupId, dealerId);

    await this.audit(session, correlationId, "DEALER_GROUP_DEALER_ASSIGNED", "dealer_group", groupId, { dealerId, dealerCode, isMainDealer, groupCode: String(group.group_code) }, dealerId);
    return { dealerId };
  }

  async listPendingRequests(session: SessionIdentity): Promise<AdminMembershipRequestRow[]> {
    const org = session.organisationId;
    const { data, error } = await this.client
      .from("dealer_group_membership_requests")
      .select("id,dealer_id,requested_group_code,status,requested_at,decided_at,decision_notes")
      .eq("organisation_id", org).eq("status", "PENDING").order("requested_at", { ascending: true });
    if (error) throw new ApiError(502, "MEMBERSHIP_REQUEST_LOAD_FAILED", "Membership requests could not be loaded");
    const rows = data as Row[] ?? [];
    const dealers = await this.loadDealers(org, [...new Set(rows.map((row) => String(row.dealer_id)))]);
    return rows.map((row) => {
      const dealer = dealers.get(String(row.dealer_id));
      return {
        ...toMembershipRequestRow(row),
        dealerId: String(row.dealer_id),
        dealerCode: dealer ? String(dealer.code) : "",
        dealerName: dealer ? String(dealer.display_name ?? dealer.name) : "",
      };
    });
  }

  private async loadPendingRequest(session: SessionIdentity, requestId: string): Promise<Row> {
    const { data, error } = await this.client.from("dealer_group_membership_requests").select("*")
      .eq("id", requestId).eq("organisation_id", session.organisationId).maybeSingle();
    if (error) throw new ApiError(502, "MEMBERSHIP_REQUEST_LOAD_FAILED", "Membership request could not be loaded");
    if (!data) throw new ApiError(404, "MEMBERSHIP_REQUEST_NOT_FOUND", "Membership request not found");
    if (data.status !== "PENDING") throw new ApiError(409, "MEMBERSHIP_REQUEST_NOT_PENDING", "This request has already been decided");
    return data as Row;
  }

  async approveRequest(session: SessionIdentity, requestId: string, correlationId: string): Promise<{ dealerId: string; groupId: string }> {
    const org = session.organisationId;
    const request = await this.loadPendingRequest(session, requestId);
    const dealerId = String(request.dealer_id);

    // Re-resolve rather than trusting the id stamped at request time -- the group may
    // have been created, renamed or removed in between.
    const { data: group, error: groupError } = await this.client.from("dealer_groups").select("id,group_code")
      .eq("organisation_id", org).eq("group_code", String(request.requested_group_code)).maybeSingle();
    if (groupError) throw new ApiError(502, "MEMBERSHIP_REQUEST_DECISION_FAILED", "Request could not be decided");
    if (!group) throw new ApiError(409, "DEALER_GROUP_NOT_FOUND", "No group matches the code on this request");
    const groupId = String(group.id);

    const dealer = (await this.loadDealers(org, [dealerId])).get(dealerId);
    if (!dealer) throw new ApiError(404, "DEALER_NOT_FOUND", "Dealer not found");
    if (dealer.dealer_group_id && String(dealer.dealer_group_id) !== groupId) {
      throw new ApiError(409, "ALREADY_IN_GROUP", "This dealer already belongs to a different group");
    }

    const { error: dealerError } = await this.client.from("dealers")
      .update({ dealer_group_id: groupId }).eq("id", dealerId).eq("organisation_id", org);
    if (dealerError) throw new ApiError(502, "MEMBERSHIP_REQUEST_DECISION_FAILED", "Request could not be decided");

    const { error } = await this.client.from("dealer_group_membership_requests").update({
      status: "APPROVED", resolved_group_id: groupId, decided_by: session.userId, decided_at: new Date().toISOString(),
    }).eq("id", requestId).eq("organisation_id", org);
    if (error) throw new ApiError(502, "MEMBERSHIP_REQUEST_DECISION_FAILED", "Request could not be decided");

    await this.audit(session, correlationId, "DEALER_GROUP_MEMBERSHIP_APPROVED", "dealer_group_membership_request", requestId, { dealerId, groupId, groupCode: String(group.group_code) }, dealerId);
    return { dealerId, groupId };
  }

  async rejectRequest(session: SessionIdentity, requestId: string, notes: string, correlationId: string): Promise<void> {
    const request = await this.loadPendingRequest(session, requestId);
    const { error } = await this.client.from("dealer_group_membership_requests").update({
      status: "REJECTED", decided_by: session.userId, decided_at: new Date().toISOString(), decision_notes: notes,
    }).eq("id", requestId).eq("organisation_id", session.organisationId);
    if (error) throw new ApiError(502, "MEMBERSHIP_REQUEST_DECISION_FAILED", "Request could not be decided");
    await this.audit(session, correlationId, "DEALER_GROUP_MEMBERSHIP_REJECTED", "dealer_group_membership_request", requestId, { notes, requestedGroupCode: String(request.requested_group_code) }, String(request.dealer_id));
  }

  /** THE partner-function trust boundary. Nothing the browser sent is believed: the
   *  ordering dealer comes from the session, every other id is looked up inside the
   *  session's own organisation and must land in the ordering dealer's own ACTIVE
   *  group. A dealer with no group (or a SUSPENDED one) may name only itself.
   *  Failures share one shape per slot so a rejected id never reveals whether it was
   *  wrong, foreign, suspended or simply nonexistent. */
  async resolveOrderPartners(session: SessionIdentity, selection: OrderPartnerSelection, correlationId: string = crypto.randomUUID()): Promise<ResolvedOrderPartners> {
    const org = session.organisationId;
    const orderingDealerId = this.sessionDealerId(session);
    const billToDealerId = selection.billToDealerId ?? orderingDealerId;
    const shipToDealerId = selection.shipToDealerId ?? orderingDealerId;

    // A failed assertion here is a real attempt to bill or ship against a dealer
    // outside the caller's own group, not a UI hiccup -- audited the same way any
    // other rejected cross-tenant write is, with the id that was refused but never
    // the fact that it might have been a valid dealer elsewhere.
    const refuse = async (code: string, message: string, evidence: Record<string, unknown>): Promise<never> => {
      await this.audit(session, correlationId, "ORDER_PARTNER_REJECTED", "dealer", orderingDealerId, { code, ...evidence }, orderingDealerId);
      throw new ApiError(403, code, message);
    };

    const dealers = await this.loadDealers(org, [...new Set([orderingDealerId, billToDealerId, shipToDealerId])]);
    const ordering = dealers.get(orderingDealerId);
    if (!isSelectableDealer(ordering)) await refuse("ORDERING_DEALER_NOT_ACTIVE", "This dealer account cannot place orders", {});

    let groupId: string | null = ordering!.dealer_group_id ? String(ordering!.dealer_group_id) : null;
    if (groupId) {
      const group = await this.loadActiveGroup(org, groupId);
      if (!group || group.status !== "ACTIVE") groupId = null;
    }

    const requireSelectable = async (candidateId: string, code: string, message: string) => {
      if (candidateId === orderingDealerId) return;
      const candidate = dealers.get(candidateId);
      if (!groupId || !candidate || String(candidate.dealer_group_id ?? "") !== groupId || !isSelectableDealer(candidate)) {
        await refuse(code, message, { candidateDealerId: candidateId });
      }
    };
    await requireSelectable(billToDealerId, "BILL_TO_NOT_SELECTABLE", "That Bill-To dealer is not available for this order");
    await requireSelectable(shipToDealerId, "SHIP_TO_NOT_SELECTABLE", "That Ship-To dealer is not available for this order");

    const shipToLocationId = selection.shipToLocationId ?? null;
    if (shipToLocationId) {
      const { data, error } = await this.client.from("dealer_locations").select("id,dealer_id,active,location_type")
        .eq("id", shipToLocationId).eq("organisation_id", org).maybeSingle();
      if (error) throw new ApiError(502, "DEALER_GROUP_LOAD_FAILED", "Delivery location could not be checked");
      const location = data as Row | null;
      if (!location || String(location.dealer_id) !== shipToDealerId || location.active !== true || !SHIP_TO_LOCATION_TYPES.includes(String(location.location_type))) {
        await refuse("SHIP_TO_LOCATION_NOT_SELECTABLE", "That delivery location is not available for this order", { shipToLocationId });
      }
    }

    return { orderingDealerId, billToDealerId, shipToDealerId, shipToLocationId, dealerGroupId: groupId };
  }
}

function toMembershipRequestRow(row: Row): MembershipRequestRow {
  return {
    id: String(row.id),
    requestedGroupCode: String(row.requested_group_code),
    status: String(row.status),
    requestedAt: String(row.requested_at),
    decidedAt: row.decided_at ? String(row.decided_at) : null,
    decisionNotes: row.decision_notes ? String(row.decision_notes) : null,
  };
}
