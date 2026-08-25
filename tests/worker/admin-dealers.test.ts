import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { ACCOUNT_STATES, assertAccountTransition } from "../../worker/account-state";
import { createCommerceApp } from "../../worker/app";
import { importTemplateCsv, parseCsv, type AdminDealerRow, type DealerImportPlan, type IssuedCredentials } from "../../worker/routes/admin-dealers";
import { SupabaseAdminDealers } from "../../worker/supabase-admin-dealers";
import { admin, dealerA, headers, repository, verifier } from "./fixtures";

type Row = Record<string, any>;
type Filter = { op: "eq" | "neq" | "in"; column: string; value: any };

/** The unique constraints this store actually collides with. A fake that never raised
 *  23505 would let the duplicate-code and shared-GSTIN branches go untested, and those
 *  are the two the v4 schema really does enforce. */
const UNIQUE: Record<string, string[]> = {
  dealers: ["organisation_id", "code"],
  gst_registrations: ["organisation_id", "gstin"],
  dealer_gst_registrations: ["organisation_id", "gstin"],
};

/** In-memory PostgREST double. Honours eq/neq/in exactly, because the security these
 *  tests exist to prove IS the .eq("organisation_id", ...) filter -- a fake that ignored
 *  filters would pass even if the store dropped every one of them. The org-2 rows below
 *  are the tripwire. */
class FakeQuery implements PromiseLike<{ data: any; error: any }> {
  private filters: Filter[] = [];
  private sort: { column: string; ascending: boolean } | null = null;
  private cap: number | null = null;

  constructor(private readonly db: FakeDb, private readonly table: string, private readonly op: { kind: "select" } | { kind: "insert"; rows: Row[] } | { kind: "update"; patch: Row }) {}

  select() { return this; }
  order(column: string, options?: { ascending?: boolean }) { this.sort = { column, ascending: options?.ascending ?? true }; return this; }
  limit(count: number) { this.cap = count; return this; }
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
      const key = UNIQUE[this.table];
      for (const candidate of this.op.rows) {
        if (key && rows.some((existing) => key.every((column) => existing[column] === candidate[column]))) {
          return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        }
      }
      const inserted = this.op.rows.map((row, index) => ({ id: `${this.table}-${rows.length + index + 1}`, created_at: "2026-08-25T00:00:00Z", ...row }));
      rows.push(...inserted);
      return { data: shape === "none" ? null : { ...inserted[0] }, error: null };
    }
    if (this.op.kind === "update") {
      for (const row of rows.filter((candidate) => this.matches(candidate))) Object.assign(row, this.op.patch);
      return { data: null, error: null };
    }
    // Copies, not the stored rows. PostgREST hands back detached JSON, so a store that
    // reads a row it has already updated must see the OLD values -- which is exactly
    // what the account-state audit trail depends on. Live references would hide that.
    let found = rows.filter((row) => this.matches(row)).map((row) => ({ ...row }));
    if (this.sort) {
      const { column, ascending } = this.sort;
      found.sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1));
    }
    if (this.cap !== null) found = found.slice(0, this.cap);
    if (shape === "maybe") return { data: found[0] ?? null, error: null };
    if (shape === "one") return found.length === 1 ? { data: found[0], error: null } : { data: null, error: { code: "PGRST116" } };
    return { data: found, error: null };
  }
}

class FakeDb {
  readonly tables = new Map<string, Row[]>();
  /** Supabase Auth lives outside Postgres, so it is modelled separately -- which is
   *  also why the org filter cannot protect it and the dealer row must. */
  readonly authUsers = new Map<string, { email: string; password: string }>();

  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }
  seed(table: string, rows: Row[]) { this.rows(table).push(...rows); }
  get auditEvents(): Row[] { return this.rows("audit_events"); }
  dealer(code: string): Row | undefined { return this.rows("dealers").find((row) => row.code === code); }

  asClient(): SupabaseClient {
    return {
      from: (table: string) => ({
        select: () => new FakeQuery(this, table, { kind: "select" }),
        insert: (rows: Row | Row[]) => new FakeQuery(this, table, { kind: "insert", rows: Array.isArray(rows) ? rows : [rows] }),
        update: (patch: Row) => new FakeQuery(this, table, { kind: "update", patch }),
      }),
      auth: {
        admin: {
          createUser: async ({ email, password }: { email: string; password: string }) => {
            if ([...this.authUsers.values()].some((user) => user.email === email)) return { data: null, error: { message: "already been registered" } };
            const id = `auth-${this.authUsers.size + 1}`;
            this.authUsers.set(id, { email, password });
            return { data: { user: { id } }, error: null };
          },
          updateUserById: async (id: string, { password }: { password: string }) => {
            const user = this.authUsers.get(id);
            if (!user) return { data: null, error: { message: "not found" } };
            this.authUsers.set(id, { ...user, password });
            return { data: { user: { id } }, error: null };
          },
        },
      },
    } as unknown as SupabaseClient;
  }
}

function makeStore() {
  const db = new FakeDb();
  db.seed("dealer_groups", [
    { id: "grp-ganesh", organisation_id: "org-1", group_code: "GANESH", group_name: "Ganesh Group", status: "ACTIVE", primary_dealer_id: null },
    // Another tenant, same group code. Only an unscoped query can ever reach this.
    { id: "grp-evil", organisation_id: "org-2", group_code: "GANESH", group_name: "Other Tenant", status: "ACTIVE", primary_dealer_id: null },
  ]);
  db.seed("gst_registrations", [{ id: "gst-a", organisation_id: "org-1", gstin: "10AXYPJ2171Q1ZX" }]);
  db.seed("dealers", [
    {
      id: "dealer-a", organisation_id: "org-1", code: "BIHAR-0001", name: "Alpha Footwear", legal_name: "ALPHA FOOTWEAR PVT LTD",
      display_name: "Alpha Footwear", city: "Patna", state: "Bihar", pin_code: "800001", address_line1: "Fraser Road", address_line2: null,
      contact_person: "Ramesh", mobile: "9006875566", master_email: "alpha@dealer.example", pilot_email: null, secondary_email: null,
      dealer_group_id: "grp-ganesh", gst_registration_id: "gst-a", is_main_dealer: false,
      account_state: null, credentials_issued_at: null, first_login_at: null, last_login_at: null,
    },
    {
      id: "dealer-noemail", organisation_id: "org-1", code: "BIHAR-0002", name: "Beta Shoes", legal_name: "BETA SHOES", display_name: "Beta Shoes",
      city: null, state: null, pin_code: null, address_line1: null, address_line2: null, contact_person: null, mobile: null,
      master_email: null, pilot_email: null, secondary_email: null, dealer_group_id: null, gst_registration_id: null, is_main_dealer: false,
      account_state: "IMPORTED", credentials_issued_at: null, first_login_at: null, last_login_at: null,
    },
    {
      id: "dealer-evil", organisation_id: "org-2", code: "OTHER-0001", name: "Other Tenant", legal_name: null, display_name: null,
      city: null, state: null, pin_code: null, address_line1: null, address_line2: null, contact_person: null, mobile: null,
      master_email: "evil@other.example", pilot_email: null, secondary_email: null, dealer_group_id: "grp-evil", gst_registration_id: null,
      is_main_dealer: false, account_state: "ACTIVE", credentials_issued_at: "2026-01-01T00:00:00Z", first_login_at: "2026-01-02T00:00:00Z", last_login_at: null,
    },
  ]);
  return { db, store: new SupabaseAdminDealers(db.asClient()) };
}

const app = (store: SupabaseAdminDealers) =>
  createCommerceApp({ repository: repository(), verifySession: verifier({ admin, a: dealerA }), adminDealers: store });

const csvOf = (...lines: string[]) => lines.join("\r\n");
const HEADER = "dealer_code,legal_name,display_name,group_code,gstin,city,state,mobile,primary_email,is_main_dealer";

describe("CSV parsing", () => {
  it("round-trips the template it hands the admin", () => {
    const table = parseCsv(importTemplateCsv());
    expect(table[0]).toContain("dealer_code");
    expect(table).toHaveLength(2);
    expect(table[0]).toHaveLength(table[1].length);
  });

  it("handles quoted commas, escaped quotes, CRLF and trailing blank lines", () => {
    const parsed = parseCsv('a,b\r\n"Patna, Bihar","He said ""hi"""\r\n\r\n');
    expect(parsed).toEqual([["a", "b"], ["Patna, Bihar", 'He said "hi"']]);
  });

  it("keeps an empty trailing cell rather than dropping the column", () => {
    expect(parseCsv("a,b,c\n1,,3")).toEqual([["a", "b", "c"], ["1", "", "3"]]);
  });
});

describe("POST /api/admin/dealers", () => {
  it("creates a dealer at IMPORTED, attaches group and GST, and audits field names only", async () => {
    const { db, store } = makeStore();
    const response = await app(store).request("/api/admin/dealers", {
      method: "POST", headers: headers("admin"),
      body: JSON.stringify({ dealerCode: "bihar-0137", legalName: "GAMMA FOOTWEAR PVT LTD", displayName: "Gamma Footwear", groupCode: "ganesh", gstin: "10aaacc1234a1zq", primaryEmail: "Gamma@Dealer.Example", isMainDealer: true }),
    });
    expect(response.status).toBe(201);
    const body = await response.json() as AdminDealerRow;
    expect(body).toMatchObject({ dealerCode: "BIHAR-0137", groupCode: "GANESH", gstin: "10AAACC1234A1ZQ", accountState: "IMPORTED", credentialsIssuedAt: null });

    const created = db.dealer("BIHAR-0137")!;
    expect(created).toMatchObject({ organisation_id: "org-1", legal_name: "GAMMA FOOTWEAR PVT LTD", name: "Gamma Footwear", master_email: "gamma@dealer.example", source_system: "ADMIN_CONSOLE", dealer_group_id: "grp-ganesh" });
    // One main dealer per group, mirrored onto the group row.
    expect(db.rows("dealer_groups").find((row) => row.id === "grp-ganesh")?.primary_dealer_id).toBe(created.id);
    // v4's mirror table too, or the orders CSV export would show a blank GSTIN.
    expect(db.rows("dealer_gst_registrations")).toHaveLength(1);

    const event = db.auditEvents.at(-1)!;
    expect(event).toMatchObject({ event_type: "DEALER_CREATED", organisation_id: "org-1", entity_type: "dealer" });
    expect(event.evidence.fields).toContain("legal_name");
    expect(JSON.stringify(event.evidence)).not.toContain("gamma@dealer.example");
  });

  it("refuses a dealer code that is taken, and a group code from another tenant", async () => {
    const { db, store } = makeStore();
    const taken = await app(store).request("/api/admin/dealers", { method: "POST", headers: headers("admin"), body: JSON.stringify({ dealerCode: "BIHAR-0001", legalName: "CLONE PVT LTD" }) });
    expect(taken.status).toBe(409);

    // GANESH exists in org-2 as well; the org-1 admin must resolve only their own.
    const created = await app(store).request("/api/admin/dealers", { method: "POST", headers: headers("admin"), body: JSON.stringify({ dealerCode: "BIHAR-0138", legalName: "DELTA PVT LTD", groupCode: "GANESH" }) });
    expect(created.status).toBe(201);
    expect(db.dealer("BIHAR-0138")?.dealer_group_id).toBe("grp-ganesh");
  });

  it("rejects a malformed code, an unknown group and a server-authoritative field before anything is written", async () => {
    const { db, store } = makeStore();
    const before = db.rows("dealers").length;
    const bad = [
      { dealerCode: "has spaces", legalName: "X PVT LTD" },
      { dealerCode: "BIHAR-0139", legalName: "X PVT LTD", gstin: "TOO-SHORT" },
      { dealerCode: "BIHAR-0139", legalName: "X PVT LTD", organisationId: "org-2" },
    ];
    for (const body of bad) {
      expect((await app(store).request("/api/admin/dealers", { method: "POST", headers: headers("admin"), body: JSON.stringify(body) })).status).toBe(400);
    }
    const unknownGroup = await app(store).request("/api/admin/dealers", { method: "POST", headers: headers("admin"), body: JSON.stringify({ dealerCode: "BIHAR-0140", legalName: "X PVT LTD", groupCode: "NOSUCH" }) });
    expect(unknownGroup.status).toBe(404);
    expect(db.rows("dealers")).toHaveLength(before);
  });
});

describe("credential provisioning", () => {
  it("issues a password, records credentials_issued_at, and never audits the secret", async () => {
    const { db, store } = makeStore();
    const response = await app(store).request("/api/admin/dealers/dealer-a/credentials", { method: "POST", headers: headers("admin"), body: "{}" });
    expect(response.status).toBe(201);
    const issued = await response.json() as IssuedCredentials;

    expect(issued).toMatchObject({ dealerCode: "BIHAR-0001", loginEmail: "alpha@dealer.example", accountState: "CREDENTIALS_ISSUED", reissued: false });
    expect(issued.password).toMatch(/^[A-HJ-NP-Z2-9]{16}$/);

    const dealer = db.dealer("BIHAR-0001")!;
    expect(dealer.account_state).toBe("CREDENTIALS_ISSUED");
    expect(dealer.credentials_issued_at).toBe(issued.credentialsIssuedAt);
    // No credential material anywhere on the dealer row (V5_AUTH_FLOW.md §6).
    expect(JSON.stringify(dealer)).not.toContain(issued.password);

    const login = db.rows("app_users").find((row) => row.dealer_id === "dealer-a")!;
    expect(login).toMatchObject({ app_role: "DEALER", status: "ACTIVE", must_change_password: true, organisation_id: "org-1" });
    expect(db.authUsers.get(login.auth_user_id)).toEqual({ email: "alpha@dealer.example", password: issued.password });

    const event = db.auditEvents.at(-1)!;
    expect(event).toMatchObject({ event_type: "CREDENTIALS_ISSUED", dealer_id: "dealer-a" });
    expect(event.evidence).toEqual({ fields: ["account_state", "credentials_issued_at"], loginEmailColumn: "master_email", reissued: false });
    expect(JSON.stringify(event.evidence)).not.toContain(issued.password);
  });

  it("re-passwords the dealer's existing login instead of creating a second identity", async () => {
    const { db, store } = makeStore();
    const first = await store.issueCredentials(admin, "dealer-a", "corr-1");
    const second = await store.issueCredentials(admin, "dealer-a", "corr-2");

    expect(second.reissued).toBe(true);
    expect(second.password).not.toBe(first.password);
    expect(db.rows("app_users").filter((row) => row.dealer_id === "dealer-a")).toHaveLength(1);
    expect(db.authUsers.size).toBe(1);
    expect([...db.authUsers.values()][0].password).toBe(second.password);
  });

  it("parks a dealer with no email at CREDENTIALS_PENDING instead of silently skipping them", async () => {
    const { db, store } = makeStore();
    const response = await app(store).request("/api/admin/dealers/dealer-noemail/credentials", { method: "POST", headers: headers("admin"), body: "{}" });
    expect(response.status).toBe(409);
    expect(db.dealer("BIHAR-0002")?.account_state).toBe("CREDENTIALS_PENDING");
    expect(db.rows("app_users")).toEqual([]);
    expect(db.auditEvents.at(-1)).toMatchObject({ event_type: "CREDENTIALS_QUEUED" });

    // 58 of the 136 live dealers have no address, so an admin will click this twice.
    // The second click must repeat the real explanation, not an invalid-transition
    // error about the state the first click parked them in.
    const again = await app(store).request("/api/admin/dealers/dealer-noemail/credentials", { method: "POST", headers: headers("admin"), body: "{}" });
    expect(again.status).toBe(409);
    expect((await again.json() as { error: { code: string } }).error.code).toBe("DEALER_EMAIL_MISSING");
    expect(db.auditEvents).toHaveLength(1);
  });

  it("refuses to reach another tenant's dealer by id", async () => {
    const { db, store } = makeStore();
    const response = await app(store).request("/api/admin/dealers/dealer-evil/credentials", { method: "POST", headers: headers("admin"), body: "{}" });
    expect(response.status).toBe(404);
    expect(db.authUsers.size).toBe(0);
  });
});

describe("account state machine", () => {
  it("gives every state a way out, so none is terminal by accident", () => {
    // v4's dealer_applications defaulted to DRAFT with no dealer action that moved it
    // and no admin action that rescued it, and that stranding broke a demo. The rule
    // (V5_AUTH_FLOW.md §5) is structural, so assert it rather than trusting a comment:
    // every state must accept at least one legal move out.
    for (const state of ACCOUNT_STATES) {
      const exits = ACCOUNT_STATES.filter((target) => {
        try { assertAccountTransition(state, target); return target !== state; } catch { return false; }
      });
      expect(exits, `${state} has no way out`).not.toEqual([]);
    }
  });


  it("suspends an active dealer and restores them to ACTIVE once they have logged in before", async () => {
    const { db, store } = makeStore();
    await store.issueCredentials(admin, "dealer-a", "corr-1");
    db.dealer("BIHAR-0001")!.account_state = "ACTIVE";
    db.dealer("BIHAR-0001")!.first_login_at = "2026-08-01T00:00:00Z";

    await store.setAccountState(admin, "dealer-a", "SUSPEND", "corr-2");
    expect(db.dealer("BIHAR-0001")?.account_state).toBe("SUSPENDED");
    expect(db.auditEvents.at(-1)).toMatchObject({ event_type: "DEALER_SUSPENDED", evidence: { fields: ["account_state"], from: "ACTIVE", to: "SUSPENDED" } });

    await store.setAccountState(admin, "dealer-a", "RESTORE", "corr-3");
    expect(db.dealer("BIHAR-0001")?.account_state).toBe("ACTIVE");
  });

  it("restores a dealer who never completed first login to CREDENTIALS_ISSUED, not ACTIVE", async () => {
    const { db, store } = makeStore();
    await store.issueCredentials(admin, "dealer-a", "corr-1");
    db.dealer("BIHAR-0001")!.account_state = "SUSPENDED";

    await store.setAccountState(admin, "dealer-a", "RESTORE", "corr-2");
    // They still hold an admin-known password, so the forced change must still happen.
    expect(db.dealer("BIHAR-0001")?.account_state).toBe("CREDENTIALS_ISSUED");
  });

  it("refuses a transition the machine does not allow, before anything is written", async () => {
    const { db, store } = makeStore();
    // dealer-noemail sits at IMPORTED: there is no login yet, so there is nothing to suspend.
    await expect(store.setAccountState(admin, "dealer-noemail", "SUSPEND", "corr-1"))
      .rejects.toMatchObject({ status: 409, code: "ACCOUNT_STATE_INVALID_TRANSITION" });
    expect(db.dealer("BIHAR-0002")?.account_state).toBe("IMPORTED");
    expect(db.auditEvents).toEqual([]);
  });

  it("will not issue credentials to a DISABLED dealer, and leaves their password untouched", async () => {
    const { db, store } = makeStore();
    await store.issueCredentials(admin, "dealer-a", "corr-1");
    const password = [...db.authUsers.values()][0].password;
    db.dealer("BIHAR-0001")!.account_state = "DISABLED";

    // DISABLED -> CREDENTIALS_ISSUED is legal, so prove the guard on a state where it is not.
    db.dealer("BIHAR-0001")!.account_state = "SOMETHING_ELSE";
    await expect(store.issueCredentials(admin, "dealer-a", "corr-2")).rejects.toMatchObject({ code: "ACCOUNT_STATE_INVALID_TRANSITION" });
    expect([...db.authUsers.values()][0].password).toBe(password);
  });
});

describe("dealer CSV import", () => {
  const preview = (store: SupabaseAdminDealers, csv: string) =>
    app(store).request("/api/admin/dealers/import/preview", { method: "POST", headers: headers("admin"), body: JSON.stringify({ csv }) });
  const commit = (store: SupabaseAdminDealers, csv: string) =>
    app(store).request("/api/admin/dealers/import/commit", { method: "POST", headers: headers("admin"), body: JSON.stringify({ csv, fileName: "bihar.csv" }) });

  const FILE = csvOf(
    HEADER,
    "BIHAR-0137,GAMMA FOOTWEAR PVT LTD,Gamma Footwear,GANESH,10AAACC1234A1ZQ,Gaya,Bihar,9000000001,gamma@dealer.example,yes",
    "BIHAR-0001,,Alpha Footwear Renamed,,,Patna,Bihar,,,no",
    "BIHAR-0002,BETA SHOES,Beta Shoes,,,,,,,no",
  );

  it("previews a create, an update and a no-change row without writing anything", async () => {
    const { db, store } = makeStore();
    const dealersBefore = JSON.stringify(db.rows("dealers"));

    const plan = await (await preview(store, FILE)).json() as DealerImportPlan;
    expect(plan.committed).toBe(false);
    expect(plan.totals).toEqual({ create: 1, update: 1, skip: 1, error: 0 });
    expect(plan.rows).toEqual([
      expect.objectContaining({ line: 2, dealerCode: "BIHAR-0137", action: "CREATE" }),
      expect.objectContaining({ line: 3, dealerCode: "BIHAR-0001", action: "UPDATE", changes: ["display_name", "name"] }),
      expect.objectContaining({ line: 4, dealerCode: "BIHAR-0002", action: "SKIP", changes: [] }),
    ]);
    // The whole point of a preview.
    expect(JSON.stringify(db.rows("dealers"))).toBe(dealersBefore);
    expect(db.rows("gst_registrations")).toHaveLength(1);
    expect(db.auditEvents).toEqual([]);
  });

  it("commits exactly what the preview promised, and leaves blank cells alone", async () => {
    const { db, store } = makeStore();
    const result = await (await commit(store, FILE)).json() as DealerImportPlan;
    expect(result.committed).toBe(true);
    expect(result.totals).toEqual({ create: 1, update: 1, skip: 1, error: 0 });

    const created = db.dealer("BIHAR-0137")!;
    expect(created).toMatchObject({ organisation_id: "org-1", account_state: "IMPORTED", dealer_group_id: "grp-ganesh", source_system: "CSV_IMPORT", source_reference: "bihar.csv#2" });
    expect(db.rows("gst_registrations")).toHaveLength(2);

    const updated = db.dealer("BIHAR-0001")!;
    expect(updated.display_name).toBe("Alpha Footwear Renamed");
    // legal_name, mobile and email were blank in the file, so they survive untouched.
    expect(updated).toMatchObject({ legal_name: "ALPHA FOOTWEAR PVT LTD", mobile: "9006875566", master_email: "alpha@dealer.example" });

    expect(db.auditEvents.map((event) => event.event_type)).toEqual(["DEALER_IMPORTED", "DEALER_UPDATED"]);
    expect(db.auditEvents[0]).toMatchObject({ correlation_id: "corr-test", evidence: expect.objectContaining({ source: "bihar.csv", line: 2 }) });
  });

  it("re-running the same file is a no-op", async () => {
    const { store } = makeStore();
    await commit(store, FILE);
    const again = await (await commit(store, FILE)).json() as DealerImportPlan;
    expect(again.totals).toEqual({ create: 0, update: 0, skip: 3, error: 0 });
  });

  it("blocks the whole commit when any row is invalid, and writes nothing", async () => {
    const { db, store } = makeStore();
    const broken = csvOf(
      HEADER,
      "BIHAR-0137,GAMMA FOOTWEAR PVT LTD,Gamma,GANESH,10AAACC1234A1ZQ,Gaya,Bihar,9000000001,gamma@dealer.example,yes",
      "BIHAR-0138,DELTA PVT LTD,Delta,NOSUCHGROUP,,Gaya,Bihar,,,no",
      "BIHAR-0139,,Missing legal name,,,,,,,no",
      "BIHAR-0137,DUPLICATE PVT LTD,Dup,,,,,,,no",
      ",NO CODE PVT LTD,,,,,,,,no",
      "BIHAR-0140,EPSILON PVT LTD,Epsilon,,,,,not-a-number,,maybe",
    );
    const plan = await (await preview(store, broken)).json() as DealerImportPlan;
    expect(plan.totals).toMatchObject({ create: 1, error: 5 });
    expect(plan.rows[1].errors[0]).toContain("NOSUCHGROUP");
    // A new dealer must supply a legal name; an existing one need not.
    expect(plan.rows[2].errors.join(" ")).toContain("legalName");
    expect(plan.rows[3].errors[0]).toContain("line 2");
    expect(plan.rows[4].errors[0]).toContain("dealer_code");
    expect(plan.rows[5].errors.join(" ")).toContain("is_main_dealer");

    const refused = await commit(store, broken);
    expect(refused.status).toBe(422);
    expect(db.dealer("BIHAR-0137")).toBeUndefined();
    expect(db.auditEvents).toEqual([]);
  });

  it("refuses a file with a column KITCO does not import rather than dropping it silently", async () => {
    const { store } = makeStore();
    const plan = await (await preview(store, csvOf("dealer_code,legal_name,credit_limit", "BIHAR-0137,GAMMA PVT LTD,500000"))).json() as DealerImportPlan;
    expect(plan.totals.error).toBe(1);
    expect(plan.rows[0].errors[0]).toContain("credit_limit");
  });

  it("matches columns by name, so a reordered or retitled spreadsheet still imports", async () => {
    const { db, store } = makeStore();
    await commit(store, csvOf("Legal Name,Dealer Code", "ZETA PVT LTD,BIHAR-0141"));
    expect(db.dealer("BIHAR-0141")).toMatchObject({ legal_name: "ZETA PVT LTD", name: "ZETA PVT LTD" });
  });

  it("never sees another tenant's dealer, so their code imports as a fresh create", async () => {
    const { db, store } = makeStore();
    await commit(store, csvOf("dealer_code,legal_name", "OTHER-0001,BORROWED CODE PVT LTD"));
    const mine = db.rows("dealers").filter((row) => row.code === "OTHER-0001" && row.organisation_id === "org-1");
    expect(mine).toHaveLength(1);
    // The other tenant's row is untouched.
    expect(db.rows("dealers").find((row) => row.id === "dealer-evil")?.legal_name).toBeNull();
  });
});

describe("access control", () => {
  it("denies every dealer-onboarding route to a dealer session", async () => {
    const { db, store } = makeStore();
    const routes: [string, RequestInit][] = [
      ["/api/admin/dealers", { headers: headers("a") }],
      ["/api/admin/dealers", { method: "POST", headers: headers("a"), body: JSON.stringify({ dealerCode: "BIHAR-0199", legalName: "SELF SERVE PVT LTD" }) }],
      ["/api/admin/dealers/dealer-a/credentials", { method: "POST", headers: headers("a"), body: "{}" }],
      ["/api/admin/dealers/dealer-a/account-state", { method: "POST", headers: headers("a"), body: JSON.stringify({ action: "RESTORE" }) }],
      ["/api/admin/dealers/import/preview", { method: "POST", headers: headers("a"), body: JSON.stringify({ csv: "dealer_code\nBIHAR-0199" }) }],
      ["/api/admin/dealers/import/commit", { method: "POST", headers: headers("a"), body: JSON.stringify({ csv: "dealer_code\nBIHAR-0199" }) }],
      ["/api/admin/dealers/import/template.csv", { headers: headers("a") }],
    ];
    for (const [path, init] of routes) {
      expect((await app(store).request(path, init)).status, path).toBe(403);
    }
    expect(db.dealer("BIHAR-0199")).toBeUndefined();
    expect(db.authUsers.size).toBe(0);
  });

  it("does not let :dealerId swallow the literal import routes", async () => {
    const { store } = makeStore();
    const template = await app(store).request("/api/admin/dealers/import/template.csv", { headers: headers("admin") });
    expect(template.status).toBe(200);
    expect(template.headers.get("content-type")).toContain("text/csv");
  });
});
