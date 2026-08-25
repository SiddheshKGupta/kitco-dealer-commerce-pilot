import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createCommerceApp } from "../../worker/app";
import type { DealerGroupPayload, MembershipRequestRow } from "../../worker/routes/dealer-groups";
import { SupabaseDealerGroups } from "../../worker/supabase-dealer-groups";
import { admin, dealerA, headers, repository, verifier } from "./fixtures";

type Row = Record<string, any>;
type Filter = { op: "eq" | "neq" | "in"; column: string; value: any };

/** In-memory PostgREST double. Deliberately honours eq/neq/in exactly, because the
 *  security these tests exist to prove IS the .eq("organisation_id", ...) filter --
 *  a fake that ignored filters would pass even if the store dropped every one of them.
 *  org-2 rows below are the tripwire for that. */
class FakeQuery implements PromiseLike<{ data: any; error: any }> {
  private filters: Filter[] = [];
  private sort: { column: string; ascending: boolean } | null = null;

  constructor(private readonly db: FakeDb, private readonly table: string, private readonly op: { kind: "select" } | { kind: "insert"; rows: Row[] } | { kind: "update"; patch: Row }) {}

  select() { return this; }
  order(column: string, options?: { ascending?: boolean }) { this.sort = { column, ascending: options?.ascending ?? true }; return this; }
  eq(column: string, value: unknown) { this.filters.push({ op: "eq", column, value }); return this; }
  neq(column: string, value: unknown) { this.filters.push({ op: "neq", column, value }); return this; }
  in(column: string, value: unknown[]) { this.filters.push({ op: "in", column, value }); return this; }
  maybeSingle() { return this.run("maybe"); }
  single() { return this.run("one"); }
  then<R1, R2>(onFulfilled?: ((value: { data: any; error: any }) => R1 | PromiseLike<R1>) | null, onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null): PromiseLike<R1 | R2> {
    return this.run("none").then(onFulfilled, onRejected);
  }

  private matches(row: Row): boolean {
    return this.filters.every((filter) => {
      if (filter.op === "eq") return row[filter.column] === filter.value;
      if (filter.op === "neq") return row[filter.column] !== filter.value;
      return (filter.value as unknown[]).includes(row[filter.column]);
    });
  }

  private async run(shape: "none" | "maybe" | "one"): Promise<{ data: any; error: any }> {
    const rows = this.db.rows(this.table);
    if (this.op.kind === "insert") {
      const inserted = this.op.rows.map((row) => ({ id: `${this.table}-${rows.length + 1}`, requested_at: "2026-08-24T00:00:00Z", created_at: "2026-08-24T00:00:00Z", ...row }));
      rows.push(...inserted);
      return { data: shape === "none" ? null : inserted[0], error: null };
    }
    if (this.op.kind === "update") {
      for (const row of rows.filter((candidate) => this.matches(candidate))) Object.assign(row, this.op.patch);
      return { data: null, error: null };
    }
    const found = rows.filter((row) => this.matches(row));
    if (this.sort) {
      const { column, ascending } = this.sort;
      found.sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1));
    }
    if (shape === "maybe") return { data: found[0] ?? null, error: null };
    if (shape === "one") return found.length === 1 ? { data: found[0], error: null } : { data: null, error: { code: "PGRST116" } };
    return { data: found, error: null };
  }
}

class FakeDb {
  readonly tables = new Map<string, Row[]>();
  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }
  seed(table: string, rows: Row[]) { this.rows(table).push(...rows); }
  get auditEvents(): Row[] { return this.rows("audit_events"); }
  asClient(): SupabaseClient {
    return {
      from: (table: string) => ({
        select: () => new FakeQuery(this, table, { kind: "select" }),
        insert: (rows: Row | Row[]) => new FakeQuery(this, table, { kind: "insert", rows: Array.isArray(rows) ? rows : [rows] }),
        update: (patch: Row) => new FakeQuery(this, table, { kind: "update", patch }),
      }),
    } as unknown as SupabaseClient;
  }
}

const ACTIVE_V4 = { activation_status: "ACTIVE", account_state: null, is_main_dealer: false };

function makeDb(): FakeDb {
  const db = new FakeDb();
  db.seed("dealer_groups", [
    { id: "grp-openai", organisation_id: "org-1", group_code: "OPENAI", group_name: "OpenAI Group", status: "ACTIVE", primary_dealer_id: null },
    { id: "grp-other", organisation_id: "org-1", group_code: "OTHER", group_name: "Other Group", status: "ACTIVE", primary_dealer_id: null },
    { id: "grp-frozen", organisation_id: "org-1", group_code: "FROZEN", group_name: "Frozen Group", status: "SUSPENDED", primary_dealer_id: null },
    { id: "grp-evil", organisation_id: "org-2", group_code: "OPENAI", group_name: "Other Tenant Group", status: "ACTIVE", primary_dealer_id: null },
  ]);
  db.seed("gst_registrations", [
    // No verification_status at all: nothing has ever been attempted, and the store
    // must read that as UNVERIFIED rather than inventing something stronger.
    { id: "gst-a", organisation_id: "org-1", gstin: "19AAACC1234A1ZQ" },
    { id: "gst-b", organisation_id: "org-1", gstin: "19BBBCC5678B1ZQ", verification_status: "NOT_LIVE_VERIFIED" },
    { id: "gst-evil", organisation_id: "org-2", gstin: "07ZZZCC9999Z1ZQ", verification_status: "VERIFIED" },
  ]);
  db.seed("dealers", [
    { id: "dealer-a", organisation_id: "org-1", code: "ADEALER", name: "CHATGPT PVT LTD", display_name: "ChatGPT", city: "Kolkata", state: "West Bengal", dealer_group_id: "grp-openai", gst_registration_id: "gst-a", ...ACTIVE_V4 },
    { id: "dealer-b", organisation_id: "org-1", code: "BDEALER", name: "HARDWARE PVT LTD", display_name: "Hardware", city: "Guwahati", state: "Assam", dealer_group_id: "grp-openai", gst_registration_id: "gst-b", activation_status: "ACTIVE", account_state: "ACTIVE", is_main_dealer: true },
    { id: "dealer-susp", organisation_id: "org-1", code: "SUSPD", name: "SUSPENDED SIBLING", display_name: "Suspended Sibling", city: "Kolkata", state: "West Bengal", dealer_group_id: "grp-openai", gst_registration_id: null, activation_status: "ACTIVE", account_state: "SUSPENDED", is_main_dealer: false },
    // Shares gst-a with dealer-a: one GSTIN per PAN per state covering several outlets
    // is the normal case, not a duplicate.
    { id: "dealer-c", organisation_id: "org-1", code: "CDEALER", name: "OUTSIDER PVT LTD", display_name: "Outsider", city: "Patna", state: "Bihar", dealer_group_id: "grp-other", gst_registration_id: "gst-a", ...ACTIVE_V4 },
    { id: "dealer-solo", organisation_id: "org-1", code: "SOLO", name: "SOLO PVT LTD", display_name: "Solo", city: "Ranchi", state: "Jharkhand", dealer_group_id: null, gst_registration_id: null, ...ACTIVE_V4 },
    { id: "dealer-frozen", organisation_id: "org-1", code: "FROZEN1", name: "FROZEN PVT LTD", display_name: "Frozen", city: "Ranchi", state: "Jharkhand", dealer_group_id: "grp-frozen", gst_registration_id: null, ...ACTIVE_V4 },
    { id: "dealer-frozen-2", organisation_id: "org-1", code: "FROZEN2", name: "FROZEN TWO PVT LTD", display_name: "Frozen Two", city: "Ranchi", state: "Jharkhand", dealer_group_id: "grp-frozen", gst_registration_id: null, ...ACTIVE_V4 },
    // Another tenant, same group code. Only an unscoped query can ever reach these.
    { id: "dealer-evil", organisation_id: "org-2", code: "EVIL", name: "OTHER TENANT", display_name: "Other Tenant", city: "Delhi", state: "Delhi", dealer_group_id: "grp-evil", gst_registration_id: null, ...ACTIVE_V4 },
  ]);
  db.seed("dealer_locations", [
    { id: "loc-a-both", organisation_id: "org-1", dealer_id: "dealer-a", name: "Kolkata Store", location_type: "BOTH", address: { city: "Kolkata" }, active: true },
    { id: "loc-b-ship", organisation_id: "org-1", dealer_id: "dealer-b", name: "Guwahati Warehouse", location_type: "SHIP_TO", address: { city: "Guwahati" }, active: true },
    { id: "loc-b-bill", organisation_id: "org-1", dealer_id: "dealer-b", name: "Hardware Billing", location_type: "BILL_TO", address: { city: "Kolkata" }, active: true },
    { id: "loc-b-closed", organisation_id: "org-1", dealer_id: "dealer-b", name: "Closed Depot", location_type: "SHIP_TO", address: {}, active: false },
    { id: "loc-evil", organisation_id: "org-2", dealer_id: "dealer-evil", name: "Other Tenant Depot", location_type: "SHIP_TO", address: {}, active: true },
  ]);
  return db;
}

function makeStore() {
  const db = makeDb();
  return { db, store: new SupabaseDealerGroups(db.asClient()) };
}

const dealerSolo = { ...dealerA, userId: "user-solo", dealerId: "dealer-solo" };
const dealerFrozen = { ...dealerA, userId: "user-frozen", dealerId: "dealer-frozen" };
const dealerB = { ...dealerA, userId: "user-b", dealerId: "dealer-b" };

describe("GET /api/dealer/group", () => {
  it("returns the dealer's own group with its selectable siblings and their ship-to locations", async () => {
    const { store } = makeStore();
    const app = createCommerceApp({ repository: repository(), verifySession: verifier({ a: dealerA }), dealerGroups: store });

    const response = await app.request("/api/dealer/group", { headers: headers("a") });
    expect(response.status).toBe(200);
    const body = await response.json() as DealerGroupPayload;

    expect(body.group).toEqual({ id: "grp-openai", groupCode: "OPENAI", groupName: "OpenAI Group", status: "ACTIVE" });
    expect(body.dealers.map((dealer) => dealer.dealerId)).toEqual(["dealer-a", "dealer-b"]);
    expect(body.dealers[0]).toMatchObject({ dealerCode: "ADEALER", displayName: "ChatGPT", gstin: "19AAACC1234A1ZQ", city: "Kolkata", isSelf: true });
    expect(body.dealers[1]).toMatchObject({ dealerCode: "BDEALER", displayName: "Hardware", gstin: "19BBBCC5678B1ZQ", isSelf: false, isMainDealer: true });
    // BILL_TO-only and inactive locations never reach the ship-to picker.
    expect(body.dealers[1].locations).toEqual([{ id: "loc-b-ship", name: "Guwahati Warehouse", locationType: "SHIP_TO", address: { city: "Guwahati" } }]);
  });

  it("omits a suspended sibling, a dealer in another group and another tenant's dealer", async () => {
    const { store } = makeStore();
    const listed = (await store.groupForDealer(dealerA)).dealers.map((dealer) => dealer.dealerId);
    expect(listed).not.toContain("dealer-susp");
    expect(listed).not.toContain("dealer-c");
    expect(listed).not.toContain("dealer-evil");
  });

  it("returns a clean empty-group response for a dealer with no group", async () => {
    const { store } = makeStore();
    const app = createCommerceApp({ repository: repository(), verifySession: verifier({ s: dealerSolo }), dealerGroups: store });

    const body = await (await app.request("/api/dealer/group", { headers: headers("s") })).json() as DealerGroupPayload;
    expect(body.group).toBeNull();
    expect(body.dealers).toHaveLength(1);
    expect(body.dealers[0]).toMatchObject({ dealerId: "dealer-solo", isSelf: true, locations: [] });
  });

  it("shows a suspended group honestly but offers only the dealer itself", async () => {
    const { store } = makeStore();
    const body = await store.groupForDealer(dealerFrozen);
    expect(body.group).toMatchObject({ groupCode: "FROZEN", status: "SUSPENDED" });
    expect(body.dealers.map((dealer) => dealer.dealerId)).toEqual(["dealer-frozen"]);
  });

  it("denies admin access to the dealer-facing group route", async () => {
    const { store } = makeStore();
    const app = createCommerceApp({ repository: repository(), verifySession: verifier({ admin }), dealerGroups: store });
    expect((await app.request("/api/dealer/group", { headers: headers("admin") })).status).toBe(403);
  });
});

describe("resolveOrderPartners -- the partner-function trust boundary", () => {
  it("defaults both partners to the ordering dealer when the browser sends nothing", async () => {
    const { store } = makeStore();
    await expect(store.resolveOrderPartners(dealerA, {})).resolves.toEqual({
      orderingDealerId: "dealer-a", billToDealerId: "dealer-a", shipToDealerId: "dealer-a", shipToLocationId: null, dealerGroupId: "grp-openai",
    });
  });

  it("accepts a sibling as Bill-To and Ship-To with that sibling's own active ship-to location", async () => {
    const { store } = makeStore();
    await expect(store.resolveOrderPartners(dealerA, { billToDealerId: "dealer-b", shipToDealerId: "dealer-b", shipToLocationId: "loc-b-ship" })).resolves.toEqual({
      orderingDealerId: "dealer-a", billToDealerId: "dealer-b", shipToDealerId: "dealer-b", shipToLocationId: "loc-b-ship", dealerGroupId: "grp-openai",
    });
  });

  it("rejects a Bill-To dealer from another group", async () => {
    const { store } = makeStore();
    await expect(store.resolveOrderPartners(dealerA, { billToDealerId: "dealer-c" })).rejects.toMatchObject({ status: 403, code: "BILL_TO_NOT_SELECTABLE" });
  });

  it("rejects a Ship-To dealer from another group", async () => {
    const { store } = makeStore();
    await expect(store.resolveOrderPartners(dealerA, { shipToDealerId: "dealer-c" })).rejects.toMatchObject({ status: 403, code: "SHIP_TO_NOT_SELECTABLE" });
  });

  it("rejects another organisation's dealer id even though its group code matches", async () => {
    const { store } = makeStore();
    await expect(store.resolveOrderPartners(dealerA, { billToDealerId: "dealer-evil" })).rejects.toMatchObject({ status: 403, code: "BILL_TO_NOT_SELECTABLE" });
    await expect(store.resolveOrderPartners(dealerA, { shipToDealerId: "dealer-evil" })).rejects.toMatchObject({ status: 403, code: "SHIP_TO_NOT_SELECTABLE" });
  });

  it("rejects a suspended sibling dealer", async () => {
    const { store } = makeStore();
    await expect(store.resolveOrderPartners(dealerA, { billToDealerId: "dealer-susp" })).rejects.toMatchObject({ code: "BILL_TO_NOT_SELECTABLE" });
  });

  it("rejects a ship-to location that belongs to a different dealer", async () => {
    const { store } = makeStore();
    await expect(store.resolveOrderPartners(dealerA, { shipToDealerId: "dealer-b", shipToLocationId: "loc-a-both" }))
      .rejects.toMatchObject({ status: 403, code: "SHIP_TO_LOCATION_NOT_SELECTABLE" });
  });

  it("rejects an inactive location and a BILL_TO-only location", async () => {
    const { store } = makeStore();
    await expect(store.resolveOrderPartners(dealerB, { shipToLocationId: "loc-b-closed" })).rejects.toMatchObject({ code: "SHIP_TO_LOCATION_NOT_SELECTABLE" });
    await expect(store.resolveOrderPartners(dealerB, { shipToLocationId: "loc-b-bill" })).rejects.toMatchObject({ code: "SHIP_TO_LOCATION_NOT_SELECTABLE" });
  });

  it("rejects another organisation's location id", async () => {
    const { store } = makeStore();
    await expect(store.resolveOrderPartners(dealerA, { shipToLocationId: "loc-evil" })).rejects.toMatchObject({ code: "SHIP_TO_LOCATION_NOT_SELECTABLE" });
  });

  it("lets a dealer with no group name only itself", async () => {
    const { store } = makeStore();
    await expect(store.resolveOrderPartners(dealerSolo, { billToDealerId: "dealer-solo", shipToDealerId: "dealer-solo" }))
      .resolves.toMatchObject({ dealerGroupId: null });
    await expect(store.resolveOrderPartners(dealerSolo, { billToDealerId: "dealer-a" })).rejects.toMatchObject({ code: "BILL_TO_NOT_SELECTABLE" });
  });

  it("withdraws sibling selection when the group is suspended, without blocking self-ordering", async () => {
    const { store } = makeStore();
    await expect(store.resolveOrderPartners(dealerFrozen, {})).resolves.toMatchObject({ billToDealerId: "dealer-frozen", dealerGroupId: null });
    await expect(store.resolveOrderPartners(dealerFrozen, { shipToDealerId: "dealer-frozen-2" })).rejects.toMatchObject({ code: "SHIP_TO_NOT_SELECTABLE" });
  });

  it("refuses to resolve partners for an admin session -- there is no ordering dealer", async () => {
    const { store } = makeStore();
    await expect(store.resolveOrderPartners(admin, {})).rejects.toMatchObject({ status: 403, code: "DEALER_REQUIRED" });
  });
});

describe("dealer membership requests", () => {
  it("returns the same response for a real group code and an invented one, and never leaks the resolution", async () => {
    const app = (store: SupabaseDealerGroups, session: typeof dealerSolo) =>
      createCommerceApp({ repository: repository(), verifySession: verifier({ s: session }), dealerGroups: store });

    const real = makeStore();
    const realResponse = await app(real.store, dealerSolo).request("/api/dealer/group/requests", { method: "POST", headers: headers("s"), body: JSON.stringify({ groupCode: "OPENAI" }) });
    const invented = makeStore();
    const inventedResponse = await app(invented.store, dealerSolo).request("/api/dealer/group/requests", { method: "POST", headers: headers("s"), body: JSON.stringify({ groupCode: "NOSUCHGROUP" }) });

    expect(realResponse.status).toBe(inventedResponse.status);
    expect(realResponse.status).toBe(201);
    const [realBody, inventedBody] = [await realResponse.json() as MembershipRequestRow, await inventedResponse.json() as MembershipRequestRow];
    expect(Object.keys(realBody).sort()).toEqual(Object.keys(inventedBody).sort());
    expect({ ...realBody, requestedGroupCode: null }).toEqual({ ...inventedBody, requestedGroupCode: null });
    // Resolved server-side for the admin queue, invisible to the dealer.
    expect(real.db.rows("dealer_group_membership_requests")[0].resolved_group_id).toBe("grp-openai");
    expect(invented.db.rows("dealer_group_membership_requests")[0].resolved_group_id).toBeNull();
  });

  it("blocks a second pending request and a dealer that already belongs to a group", async () => {
    const { store } = makeStore();
    await store.requestMembership(dealerSolo, "OPENAI", "corr-1");
    await expect(store.requestMembership(dealerSolo, "OPENAI", "corr-2")).rejects.toMatchObject({ status: 409, code: "REQUEST_ALREADY_PENDING" });
    await expect(store.requestMembership(dealerA, "OTHER", "corr-3")).rejects.toMatchObject({ status: 409, code: "ALREADY_IN_GROUP" });
  });

  it("lists only the dealer's own requests", async () => {
    const { store } = makeStore();
    await store.requestMembership(dealerSolo, "OPENAI", "corr-1");
    const app = createCommerceApp({ repository: repository(), verifySession: verifier({ s: dealerSolo, f: dealerFrozen }), dealerGroups: store });

    const own = await (await app.request("/api/dealer/group/requests", { headers: headers("s") })).json() as { requests: MembershipRequestRow[] };
    expect(own.requests).toEqual([expect.objectContaining({ requestedGroupCode: "OPENAI", status: "PENDING", decidedAt: null })]);
    const other = await (await app.request("/api/dealer/group/requests", { headers: headers("f") })).json() as { requests: MembershipRequestRow[] };
    expect(other.requests).toEqual([]);
  });

  it("rejects a malformed group code before anything is written", async () => {
    const { store, db } = makeStore();
    const app = createCommerceApp({ repository: repository(), verifySession: verifier({ s: dealerSolo }), dealerGroups: store });
    const response = await app.request("/api/dealer/group/requests", { method: "POST", headers: headers("s"), body: JSON.stringify({ groupCode: "bad code!" }) });
    expect(response.status).toBe(400);
    expect(db.rows("dealer_group_membership_requests")).toEqual([]);
  });
});

describe("admin dealer groups", () => {
  const adminApp = (store: SupabaseDealerGroups) =>
    createCommerceApp({ repository: repository(), verifySession: verifier({ admin, a: dealerA }), dealerGroups: store });

  it("lists groups with live dealer counts", async () => {
    const { store } = makeStore();
    const body = await (await adminApp(store).request("/api/admin/dealer-groups", { headers: headers("admin") })).json() as { groups: Row[] };
    expect(body.groups).toEqual([
      expect.objectContaining({ groupCode: "FROZEN", status: "SUSPENDED", dealerCount: 2 }),
      expect.objectContaining({ groupCode: "OPENAI", dealerCount: 3 }),
      expect.objectContaining({ groupCode: "OTHER", dealerCount: 1 }),
    ]);
  });

  it("creates a group and assigns a dealer to it as the main dealer", async () => {
    const { store, db } = makeStore();
    const app = adminApp(store);

    const invalid = await app.request("/api/admin/dealer-groups", { method: "POST", headers: headers("admin"), body: JSON.stringify({ groupCode: "no spaces!", groupName: "X" }) });
    expect(invalid.status).toBe(400);

    const created = await app.request("/api/admin/dealer-groups", { method: "POST", headers: headers("admin"), body: JSON.stringify({ groupCode: "anthropic", groupName: "Anthropic Group" }) });
    expect(created.status).toBe(201);
    const { id } = await created.json() as { id: string };
    expect(db.rows("dealer_groups").find((row) => row.id === id)).toMatchObject({ group_code: "ANTHROPIC", organisation_id: "org-1" });

    const assigned = await app.request(`/api/admin/dealer-groups/${id}/dealers`, { method: "POST", headers: headers("admin"), body: JSON.stringify({ dealerCode: "SOLO", isMainDealer: true }) });
    expect(assigned.status).toBe(201);
    await expect(assigned.json()).resolves.toEqual({ dealerId: "dealer-solo" });
    expect(db.rows("dealers").find((row) => row.id === "dealer-solo")).toMatchObject({ dealer_group_id: id, is_main_dealer: true });
    expect(db.rows("dealer_groups").find((row) => row.id === id)?.primary_dealer_id).toBe("dealer-solo");
    expect(db.auditEvents.at(-1)).toMatchObject({ event_type: "DEALER_GROUP_DEALER_ASSIGNED", dealer_id: "dealer-solo", organisation_id: "org-1" });
  });

  it("renames a group, leaves its code alone and writes audit", async () => {
    const { store, db } = makeStore();
    const app = adminApp(store);

    const blank = await app.request("/api/admin/dealer-groups/grp-openai/name", { method: "POST", headers: headers("admin"), body: JSON.stringify({ groupName: "X" }) });
    expect(blank.status).toBe(400);

    const renamed = await app.request("/api/admin/dealer-groups/grp-openai/name", { method: "POST", headers: headers("admin"), body: JSON.stringify({ groupName: "OpenAI Retail Group" }) });
    expect(renamed.status).toBe(200);
    expect(db.rows("dealer_groups").find((row) => row.id === "grp-openai")).toMatchObject({ group_name: "OpenAI Retail Group", group_code: "OPENAI" });
    expect(db.auditEvents.at(-1)).toMatchObject({
      event_type: "DEALER_GROUP_RENAMED", entity_id: "grp-openai", organisation_id: "org-1",
      evidence: { groupCode: "OPENAI", from: "OpenAI Group", to: "OpenAI Retail Group" },
    });
  });

  it("refuses to rename another organisation's group", async () => {
    const { store, db } = makeStore();
    const response = await adminApp(store).request("/api/admin/dealer-groups/grp-evil/name", { method: "POST", headers: headers("admin"), body: JSON.stringify({ groupName: "Renamed By Neighbour" }) });
    expect(response.status).toBe(404);
    expect(db.rows("dealer_groups").find((row) => row.id === "grp-evil")?.group_name).toBe("Other Tenant Group");
  });

  it("lists GST registrations with the dealers sharing each, and never another tenant's", async () => {
    const { store } = makeStore();
    const body = await (await adminApp(store).request("/api/admin/gst-registrations", { headers: headers("admin") })).json() as { registrations: Row[] };

    expect(body.registrations.map((row) => row.gstin)).toEqual(["19AAACC1234A1ZQ", "19BBBCC5678B1ZQ"]);
    const [shared, single] = body.registrations;
    // Sharing is the normal case: two outlets, one registration, no error anywhere.
    expect(shared.dealers.map((dealer: Row) => dealer.dealerCode)).toEqual(["ADEALER", "CDEALER"]);
    expect(shared.verificationStatus).toBe("UNVERIFIED");
    expect(single.dealers).toEqual([expect.objectContaining({ dealerCode: "BDEALER", isMainDealer: true })]);
    // Mock evidence stays its own value -- it must never be reported as VERIFIED.
    expect(single.verificationStatus).toBe("NOT_LIVE_VERIFIED");
  });

  it("does not let :groupId shadow the literal /requests route", async () => {
    const { store } = makeStore();
    const response = await adminApp(store).request("/api/admin/dealer-groups/requests", { headers: headers("admin") });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ requests: [] });
  });

  it("approves a pending request, moves the dealer into the group and writes audit", async () => {
    const { store, db } = makeStore();
    const request = await store.requestMembership(dealerSolo, "OPENAI", "corr-request");
    const app = adminApp(store);

    const pending = await (await app.request("/api/admin/dealer-groups/requests", { headers: headers("admin") })).json() as { requests: Row[] };
    expect(pending.requests).toEqual([expect.objectContaining({ dealerId: "dealer-solo", dealerCode: "SOLO", dealerName: "Solo", requestedGroupCode: "OPENAI" })]);

    const approved = await app.request(`/api/admin/dealer-groups/requests/${request.id}/approve`, { method: "POST", headers: headers("admin"), body: "{}" });
    expect(approved.status).toBe(200);
    await expect(approved.json()).resolves.toEqual({ dealerId: "dealer-solo", groupId: "grp-openai" });

    expect(db.rows("dealers").find((row) => row.id === "dealer-solo")?.dealer_group_id).toBe("grp-openai");
    expect(db.rows("dealer_group_membership_requests")[0]).toMatchObject({ status: "APPROVED", resolved_group_id: "grp-openai", decided_by: admin.userId });
    expect(db.auditEvents.at(-1)).toMatchObject({
      organisation_id: "org-1", dealer_id: "dealer-solo", actor_auth_user_id: admin.userId,
      event_type: "DEALER_GROUP_MEMBERSHIP_APPROVED", entity_type: "dealer_group_membership_request", entity_id: request.id,
      correlation_id: "corr-test", evidence: { dealerId: "dealer-solo", groupId: "grp-openai", groupCode: "OPENAI" },
    });
    // Newly approved sibling is now selectable -- the list and the validator agree.
    await expect(store.resolveOrderPartners(dealerA, { billToDealerId: "dealer-solo" })).resolves.toMatchObject({ billToDealerId: "dealer-solo" });
  });

  it("rejects a request with mandatory notes and writes audit, leaving the dealer ungrouped", async () => {
    const { store, db } = makeStore();
    const request = await store.requestMembership(dealerSolo, "OPENAI", "corr-request");
    const app = adminApp(store);

    const noNotes = await app.request(`/api/admin/dealer-groups/requests/${request.id}/reject`, { method: "POST", headers: headers("admin"), body: JSON.stringify({}) });
    expect(noNotes.status).toBe(400);

    const rejected = await app.request(`/api/admin/dealer-groups/requests/${request.id}/reject`, { method: "POST", headers: headers("admin"), body: JSON.stringify({ notes: "Group owner did not confirm this dealer" }) });
    expect(rejected.status).toBe(200);
    expect(db.rows("dealers").find((row) => row.id === "dealer-solo")?.dealer_group_id).toBeNull();
    expect(db.rows("dealer_group_membership_requests")[0]).toMatchObject({ status: "REJECTED", decision_notes: "Group owner did not confirm this dealer" });
    expect(db.auditEvents.at(-1)).toMatchObject({
      event_type: "DEALER_GROUP_MEMBERSHIP_REJECTED", entity_id: request.id, dealer_id: "dealer-solo",
      evidence: { notes: "Group owner did not confirm this dealer", requestedGroupCode: "OPENAI" },
    });
  });

  it("refuses to decide an already-decided request, before any second audit write", async () => {
    const { store, db } = makeStore();
    const request = await store.requestMembership(dealerSolo, "OPENAI", "corr-request");
    await store.approveRequest(admin, request.id, "corr-approve");
    const auditCount = db.auditEvents.length;

    await expect(store.rejectRequest(admin, request.id, "changed my mind", "corr-late")).rejects.toMatchObject({ status: 409, code: "MEMBERSHIP_REQUEST_NOT_PENDING" });
    expect(db.auditEvents).toHaveLength(auditCount);
  });

  it("stops a dealer approving its own membership request", async () => {
    const { store, db } = makeStore();
    const request = await store.requestMembership(dealerSolo, "OPENAI", "corr-request");
    const app = createCommerceApp({ repository: repository(), verifySession: verifier({ s: dealerSolo }), dealerGroups: store });

    for (const path of [`/api/admin/dealer-groups/requests/${request.id}/approve`, `/api/admin/dealer-groups/requests/${request.id}/reject`]) {
      const response = await app.request(path, { method: "POST", headers: headers("s"), body: JSON.stringify({ notes: "let me in please" }) });
      expect(response.status).toBe(403);
    }
    expect((await app.request("/api/admin/dealer-groups", { headers: headers("s") })).status).toBe(403);
    expect(db.rows("dealers").find((row) => row.id === "dealer-solo")?.dealer_group_id).toBeNull();
    expect(db.rows("dealer_group_membership_requests")[0].status).toBe("PENDING");
  });
});
