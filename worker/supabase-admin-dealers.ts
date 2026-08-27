import type { SupabaseClient } from "@supabase/supabase-js";
import { assertAccountTransition, type AccountState } from "./account-state";
import type { NoticeMailer } from "./auth/resend-provider";
import { resolveGstRegistration } from "./gst-registration";
import type { SessionIdentity } from "./middleware/auth";
import { ApiError } from "./middleware/errors";
import { syncMainDealer } from "./sync-main-dealer";
import {
  createDealerSchema,
  updateDealerSchema,
  IMPORT_COLUMNS,
  parseCsv,
  type AccountStateAction,
  type AdminDealerInput,
  type AdminDealerRow,
  type AdminDealersStore,
  type DealerImportPlan,
  type DealerImportRowPlan,
  type ImportColumn,
  type IssuedCredentials,
} from "./routes/admin-dealers";

type Row = Record<string, any>;

const DEALER_SELECT = "id,code,name,legal_name,display_name,city,state,pin_code,address_line1,address_line2,"
  + "contact_person,mobile,master_email,pilot_email,secondary_email,dealer_group_id,gst_registration_id,"
  + "is_main_dealer,account_state,credentials_issued_at,first_login_at,last_login_at";

/** 16 characters of a 32-symbol alphabet, ~80 bits. I/O/0/1 are excluded because KITCO
 *  reads this password to a dealer out of band, and 32 divides 256 exactly so the
 *  modulo below is unbiased. Never persisted anywhere: V5_AUTH_FLOW.md §6 keeps
 *  credential material out of `dealers`, which admin queries and exports read freely. */
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generatePassword(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length]).join("");
}

/** Compares a CSV cell against what the database already holds. null and "" are the
 *  same absence, and everything else compares as text, so an unchanged row is
 *  correctly reported as SKIP rather than as a no-op UPDATE. */
function sameValue(current: unknown, next: unknown): boolean {
  if (current === null || current === undefined || current === "") return next === null || next === undefined || next === "";
  return String(current) === String(next);
}

const TRUE_WORDS = new Set(["yes", "y", "true", "1"]);
const FALSE_WORDS = new Set(["no", "n", "false", "0"]);

/** Header names are matched, not positions, so an admin who reorders or renames the
 *  columns in Excel ("Dealer Code") still imports cleanly. */
function normaliseHeader(value: string): string {
  return value.trim().toLowerCase().replaceAll(/[\s-]+/gu, "_");
}

/** A create or update the plan has already proved valid, ready to apply. */
interface PlannedWrite {
  line: number;
  dealerCode: string;
  dealerId: string | null;
  patch: Row;
  gstin: string | null;
  groupId: string | null;
  isMainDealer: boolean;
  fields: string[];
}

export class SupabaseAdminDealers implements AdminDealersStore {
  constructor(
    private readonly client: SupabaseClient,
    // Optional so every existing test double keeps working unchanged; production
    // always wires one. Without it, credentials are issued exactly as before --
    // shown once in the admin's response, never emailed -- rather than throwing.
    private readonly mailer?: NoticeMailer,
    private readonly portalUrl = "https://partners.kitco.co.in",
  ) {}

  /** Never throws: credentials are already issued and committed by the time this
   *  runs, so a bounced mailbox must not turn a successful issuance into an error
   *  the admin has to guess about. Mirrors SupabaseDealerApplicationsAdmin.notify. */
  private async notify(to: string, correlationId: string, subject: string, text: string): Promise<void> {
    if (!this.mailer) return;
    try {
      await this.mailer.sendNotice({ to, subject, text, correlationId });
    } catch {
      console.error("admin_dealers.notice_failed", { correlationId });
    }
  }

  private async audit(
    session: SessionIdentity,
    correlationId: string,
    eventType: string,
    dealerId: string,
    evidence: Record<string, unknown>,
  ) {
    await this.client.from("audit_events").insert({
      organisation_id: session.organisationId,
      dealer_id: dealerId,
      actor_auth_user_id: session.userId,
      event_type: eventType,
      entity_type: "dealer",
      entity_id: dealerId,
      correlation_id: correlationId,
      evidence,
    });
  }

  /** Every dealer read in this file goes through here, so the organisation filter can
   *  never be forgotten on one branch: the Worker holds the service-role key and
   *  bypasses RLS, so this filter is the only thing standing between tenants. */
  private async loadRow(organisationId: string, dealerId: string): Promise<Row> {
    const { data, error } = await this.client
      .from("dealers")
      .select(DEALER_SELECT)
      .eq("id", dealerId)
      .eq("organisation_id", organisationId)
      .maybeSingle();
    if (error) throw new ApiError(502, "DEALER_LOAD_FAILED", "Dealer could not be loaded");
    if (!data) throw new ApiError(404, "DEALER_NOT_FOUND", "Dealer not found");
    return data as Row;
  }

  private async lookups(organisationId: string): Promise<{ groupCodeById: Map<string, string>; groupIdByCode: Map<string, string>; gstinById: Map<string, string>; gstIdByGstin: Map<string, string> }> {
    const [groups, registrations] = await Promise.all([
      this.client.from("dealer_groups").select("id,group_code").eq("organisation_id", organisationId),
      this.client.from("gst_registrations").select("id,gstin").eq("organisation_id", organisationId),
    ]);
    if (groups.error || registrations.error) throw new ApiError(502, "DEALER_LOAD_FAILED", "Dealer reference data could not be loaded");
    const groupRows = (groups.data as Row[]) ?? [];
    const gstRows = (registrations.data as Row[]) ?? [];
    return {
      groupCodeById: new Map(groupRows.map((row) => [String(row.id), String(row.group_code)])),
      groupIdByCode: new Map(groupRows.map((row) => [String(row.group_code), String(row.id)])),
      gstinById: new Map(gstRows.map((row) => [String(row.id), String(row.gstin)])),
      gstIdByGstin: new Map(gstRows.map((row) => [String(row.gstin), String(row.id)])),
    };
  }

  private toDealerRow(row: Row, groupCodeById: Map<string, string>, gstinById: Map<string, string>): AdminDealerRow {
    return {
      id: String(row.id),
      dealerCode: String(row.code),
      legalName: row.legal_name ?? null,
      displayName: String(row.display_name ?? row.name),
      groupCode: row.dealer_group_id ? groupCodeById.get(String(row.dealer_group_id)) ?? null : null,
      gstin: row.gst_registration_id ? gstinById.get(String(row.gst_registration_id)) ?? null : null,
      city: row.city ?? null,
      state: row.state ?? null,
      isMainDealer: row.is_main_dealer === true,
      accountState: row.account_state ?? null,
      credentialsIssuedAt: row.credentials_issued_at ?? null,
      firstLoginAt: row.first_login_at ?? null,
      lastLoginAt: row.last_login_at ?? null,
      loginEmail: loginEmailOf(row),
    };
  }

  async list(session: SessionIdentity): Promise<AdminDealerRow[]> {
    const org = session.organisationId;
    const { data, error } = await this.client.from("dealers").select(DEALER_SELECT).eq("organisation_id", org).order("code");
    if (error) throw new ApiError(502, "DEALER_LOAD_FAILED", "Dealers could not be loaded");
    const { groupCodeById, gstinById } = await this.lookups(org);
    return ((data as Row[]) ?? []).map((row) => this.toDealerRow(row, groupCodeById, gstinById));
  }

  private async load(session: SessionIdentity, dealerId: string): Promise<AdminDealerRow> {
    const { groupCodeById, gstinById } = await this.lookups(session.organisationId);
    return this.toDealerRow(await this.loadRow(session.organisationId, dealerId), groupCodeById, gstinById);
  }

  async create(session: SessionIdentity, input: AdminDealerInput, correlationId: string): Promise<AdminDealerRow> {
    const org = session.organisationId;
    const { groupIdByCode } = await this.lookups(org);
    const groupId = input.groupCode ? groupIdByCode.get(input.groupCode) ?? null : null;
    if (input.groupCode && !groupId) throw new ApiError(404, "DEALER_GROUP_NOT_FOUND", "No dealer group has this code. Create the group first.");

    const patch = dealerPatch(input);
    if (groupId) patch.dealer_group_id = groupId;
    if (input.gstin) patch.gst_registration_id = await resolveGstRegistration(this.client, org, input.gstin);

    const { data, error } = await this.client.from("dealers").insert({
      organisation_id: org,
      ...patch,
      account_state: "IMPORTED",
      source_system: "ADMIN_CONSOLE",
      last_synced_at: new Date().toISOString(),
    }).select("id").maybeSingle();
    if (error?.code === "23505") throw new ApiError(409, "DEALER_CODE_TAKEN", "A dealer with this code already exists");
    if (error || !data) throw new ApiError(502, "DEALER_CREATE_FAILED", "Dealer could not be created");
    const dealerId = String(data.id);

    if (input.isMainDealer && groupId) await syncMainDealer(this.client, org, groupId, dealerId);

    // Field names only. This log is read by KITCO staff and the values are dealer PII.
    await this.audit(session, correlationId, "DEALER_CREATED", dealerId, { fields: Object.keys(patch), source: "ADMIN_CONSOLE" });
    return this.load(session, dealerId);
  }

  async issueCredentials(session: SessionIdentity, dealerId: string, correlationId: string): Promise<IssuedCredentials> {
    const org = session.organisationId;
    const dealer = await this.loadRow(org, dealerId);
    // Checked before anything is generated: a rejected transition must never leave a
    // dealer holding a password that was set on their auth user and recorded nowhere.
    const state = assertAccountTransition(dealer.account_state, "CREDENTIALS_ISSUED");

    const emailColumn = dealer.pilot_email ? "pilot_email" : dealer.master_email ? "master_email" : null;
    if (!emailColumn) {
      // Parked, not silently skipped: CREDENTIALS_PENDING is what puts this dealer in
      // the console's exception list instead of leaving them looking finished (§8).
      // 58 of the 136 live dealers have no address at all, so an admin will click this
      // twice; parking again must stay a no-op and still explain the real problem
      // rather than surfacing an invalid-transition error about a state we chose.
      if (dealer.account_state !== "CREDENTIALS_PENDING") {
        await this.moveAccountState(session, dealer, "CREDENTIALS_PENDING", "CREDENTIALS_QUEUED", correlationId);
      }
      throw new ApiError(409, "DEALER_EMAIL_MISSING", "This dealer has no email on file, so a one-time code could never reach them. Add an email, then issue credentials.");
    }

    const loginEmail = String(dealer[emailColumn]).toLowerCase();
    const password = generatePassword();
    const reissued = await this.upsertDealerLogin(org, dealerId, loginEmail, password);

    const credentialsIssuedAt = new Date().toISOString();
    const { error } = await this.client.from("dealers")
      .update({ account_state: state, credentials_issued_at: credentialsIssuedAt, updated_at: credentialsIssuedAt })
      .eq("id", dealerId).eq("organisation_id", org);
    if (error) throw new ApiError(502, "CREDENTIALS_ISSUE_FAILED", "Credentials could not be issued");

    // Which column the address came from, never the address; never the password.
    await this.audit(session, correlationId, "CREDENTIALS_ISSUED", dealerId, {
      fields: ["account_state", "credentials_issued_at"], loginEmailColumn: emailColumn, reissued,
    });
    await this.notify(loginEmail, correlationId,
      reissued ? "Your KITCO password has been reset" : "Your KITCO dealer account is ready",
      `Sign in at ${this.portalUrl}/login with:\n\n` +
      `Dealer Code: ${dealer.code}\n` +
      `Password: ${password}\n\n` +
      `You'll be sent a one-time code by email to confirm it's you, and asked to choose your own password on your first sign-in.`);

    return { dealerId, dealerCode: String(dealer.code), loginEmail, password, accountState: state, credentialsIssuedAt, reissued };
  }

  /** Returns true when an existing login was re-passworded rather than created. */
  private async upsertDealerLogin(organisationId: string, dealerId: string, email: string, password: string): Promise<boolean> {
    const { data: mapping, error } = await this.client.from("app_users").select("auth_user_id")
      .eq("organisation_id", organisationId).eq("dealer_id", dealerId).eq("app_role", "DEALER").limit(1).maybeSingle();
    if (error) throw new ApiError(502, "CREDENTIALS_ISSUE_FAILED", "Credentials could not be issued");

    if (mapping?.auth_user_id) {
      // The dealer already has an identity from v4 activation. Set a real password on
      // that one rather than creating a second: a new auth user would orphan their
      // whole order history (V5_AUTH_FLOW.md §8).
      const { error: passwordError } = await this.client.auth.admin.updateUserById(String(mapping.auth_user_id), { password });
      if (passwordError) throw new ApiError(502, "CREDENTIALS_ISSUE_FAILED", "Credentials could not be issued");
      const { error: flagError } = await this.client.from("app_users").update({ must_change_password: true, status: "ACTIVE" })
        .eq("organisation_id", organisationId).eq("dealer_id", dealerId).eq("app_role", "DEALER");
      if (flagError) throw new ApiError(502, "CREDENTIALS_ISSUE_FAILED", "Credentials could not be issued");
      return true;
    }

    const { data: created, error: createError } = await this.client.auth.admin.createUser({ email, password, email_confirm: true });
    if (createError || !created?.user) {
      // An address already attached to another account is a data problem KITCO has to
      // see and fix, not something to paper over by handing this dealer someone else's
      // login and, with it, someone else's orders.
      throw new ApiError(409, "DEALER_LOGIN_EMAIL_UNAVAILABLE", "That email is already attached to another KITCO account. Give this dealer their own address, then issue credentials.");
    }
    const { error: mappingError } = await this.client.from("app_users").insert({
      organisation_id: organisationId, dealer_id: dealerId, auth_user_id: created.user.id,
      app_role: "DEALER", status: "ACTIVE", must_change_password: true,
    });
    if (mappingError) throw new ApiError(502, "CREDENTIALS_ISSUE_FAILED", "Credentials could not be issued");
    return false;
  }

  private async moveAccountState(session: SessionIdentity, dealer: Row, target: AccountState, eventType: string, correlationId: string): Promise<void> {
    const state = assertAccountTransition(dealer.account_state, target);
    const now = new Date().toISOString();
    const { error } = await this.client.from("dealers").update({ account_state: state, updated_at: now })
      .eq("id", dealer.id).eq("organisation_id", session.organisationId);
    if (error) throw new ApiError(502, "ACCOUNT_STATE_UPDATE_FAILED", "Dealer account state could not be updated");
    await this.audit(session, correlationId, eventType, String(dealer.id), {
      fields: ["account_state"], from: dealer.account_state ?? null, to: state,
    });
  }

  async setAccountState(session: SessionIdentity, dealerId: string, action: AccountStateAction, correlationId: string): Promise<AdminDealerRow> {
    const dealer = await this.loadRow(session.organisationId, dealerId);
    // RESTORE has no fixed destination. A dealer who never completed first login still
    // holds an admin-known password, so they return to CREDENTIALS_ISSUED and must
    // still be forced through the change; only a dealer who has logged in before goes
    // straight back to ACTIVE.
    const target: AccountState = action === "SUSPEND" ? "SUSPENDED"
      : action === "DISABLE" ? "DISABLED"
        : dealer.first_login_at ? "ACTIVE" : "CREDENTIALS_ISSUED";
    const eventType = action === "SUSPEND" ? "DEALER_SUSPENDED" : action === "DISABLE" ? "DEALER_DISABLED" : "DEALER_RESTORED";
    await this.moveAccountState(session, dealer, target, eventType, correlationId);
    return this.load(session, dealerId);
  }

  // ------------------------------------------------------------------------ import
  /** Parses, validates and diffs the file without writing a single row. Both the
   *  preview and the commit run this, so what the admin approved is exactly what is
   *  re-derived a moment later -- there is no stored plan to drift out of date. */
  private async buildPlan(session: SessionIdentity, csv: string): Promise<{ rows: DealerImportRowPlan[]; writes: PlannedWrite[] }> {
    const org = session.organisationId;
    const table = parseCsv(csv);
    const header = table[0];
    if (!header) return { rows: [fileError(1, "The file is empty.")], writes: [] };

    const columns = header.map(normaliseHeader);
    const unknown = columns.filter((column) => column !== "" && !(IMPORT_COLUMNS as readonly string[]).includes(column));
    // Unknown columns are refused rather than ignored: silently dropping a column the
    // admin took the trouble to fill in is the import lying about what it imported.
    if (unknown.length > 0) return { rows: [fileError(1, `This file has columns KITCO does not import: ${unknown.join(", ")}. Start from the template.`)], writes: [] };
    if (!columns.includes("dealer_code")) return { rows: [fileError(1, "This file has no dealer_code column. Start from the template.")], writes: [] };

    const dataRows = table.slice(1).map((cells, index) => ({ line: index + 2, cells })).filter(({ cells }) => cells.some((cell) => cell.trim() !== ""));
    const codes = [...new Set(dataRows.map(({ cells }) => cellAt(cells, columns, "dealer_code").toUpperCase()).filter(Boolean))];
    const [existing, lookups] = await Promise.all([this.loadByCode(org, codes), this.lookups(org)]);

    const rows: DealerImportRowPlan[] = [];
    const writes: PlannedWrite[] = [];
    const seen = new Map<string, number>();

    for (const { line, cells } of dataRows) {
      const record = Object.fromEntries(columns.map((column, index) => [column, (cells[index] ?? "").trim()]).filter(([column]) => column !== "")) as Record<string, string>;
      const dealerCode = (record.dealer_code ?? "").toUpperCase();
      const errors: string[] = [];

      if (!dealerCode) { rows.push({ line, dealerCode: "", action: "ERROR", changes: [], errors: ["dealer_code is required."] }); continue; }
      if (seen.has(dealerCode)) {
        rows.push({ line, dealerCode, action: "ERROR", changes: [], errors: [`This dealer code already appears on line ${seen.get(dealerCode)}.`] });
        continue;
      }
      seen.set(dealerCode, line);

      const input = toInput(record, errors);
      const current = existing.get(dealerCode);
      const parsed = (current ? updateDealerSchema : createDealerSchema).safeParse(input);
      if (!parsed.success) errors.push(...parsed.error.issues.map((issue) => `${issue.path.join(".") || "row"}: ${issue.message}`));

      const groupCode = parsed.success ? parsed.data.groupCode : undefined;
      const groupId = groupCode ? lookups.groupIdByCode.get(groupCode) ?? null : null;
      if (groupCode && !groupId) errors.push(`No dealer group has the code ${groupCode}. Create the group first.`);

      if (errors.length > 0 || !parsed.success) { rows.push({ line, dealerCode, action: "ERROR", changes: [], errors }); continue; }

      const value = parsed.data;
      const patch = dealerPatch(value);
      const changes = Object.keys(patch).filter((column) => !current || !sameValue(current[column], patch[column]));
      if (groupId && (!current || String(current.dealer_group_id ?? "") !== groupId)) changes.push("dealer_group_id");
      const currentGstin = current?.gst_registration_id ? lookups.gstinById.get(String(current.gst_registration_id)) ?? null : null;
      if (value.gstin && value.gstin !== currentGstin) changes.push("gst_registration_id");

      if (current && changes.length === 0) { rows.push({ line, dealerCode, action: "SKIP", changes: [], errors: [] }); continue; }
      rows.push({ line, dealerCode, action: current ? "UPDATE" : "CREATE", changes, errors: [] });
      writes.push({
        line, dealerCode, dealerId: current ? String(current.id) : null, patch,
        gstin: value.gstin ?? null, groupId, isMainDealer: value.isMainDealer === true, fields: changes,
      });
    }

    return { rows, writes };
  }

  private async loadByCode(organisationId: string, codes: string[]): Promise<Map<string, Row>> {
    if (codes.length === 0) return new Map();
    const { data, error } = await this.client.from("dealers").select(DEALER_SELECT).eq("organisation_id", organisationId).in("code", codes);
    if (error) throw new ApiError(502, "DEALER_LOAD_FAILED", "Existing dealers could not be checked");
    return new Map(((data as Row[]) ?? []).map((row) => [String(row.code), row]));
  }

  async previewImport(session: SessionIdentity, csv: string): Promise<DealerImportPlan> {
    const { rows } = await this.buildPlan(session, csv);
    return { rows, totals: totalsOf(rows), committed: false };
  }

  async commitImport(session: SessionIdentity, csv: string, fileName: string, correlationId: string): Promise<DealerImportPlan> {
    const { rows, writes } = await this.buildPlan(session, csv);
    const planned = totalsOf(rows);
    if (planned.error > 0) {
      throw new ApiError(422, "DEALER_IMPORT_HAS_ERRORS", "Fix the rows listed below and upload the file again. Nothing has been imported.", { rows, totals: planned, committed: false });
    }

    const outcome = new Map(rows.map((row) => [row.line, row]));
    for (const write of writes) {
      try {
        await this.applyWrite(session, write, fileName, correlationId);
      } catch (caught) {
        // PostgREST gives no transaction across these calls, so a failure halfway
        // leaves earlier rows committed. Reporting the failed row honestly beats
        // pretending the whole file rolled back: re-uploading the same file is
        // idempotent, and every row that landed comes back as SKIP.
        const row = outcome.get(write.line)!;
        row.action = "ERROR";
        row.errors = [caught instanceof ApiError ? caught.message : "This row could not be saved."];
      }
    }

    return { rows, totals: totalsOf(rows), committed: true };
  }

  private async applyWrite(session: SessionIdentity, write: PlannedWrite, fileName: string, correlationId: string): Promise<void> {
    const org = session.organisationId;
    const now = new Date().toISOString();
    const patch: Row = { ...write.patch, source_system: "CSV_IMPORT", source_reference: `${fileName}#${write.line}`, last_synced_at: now };
    if (write.groupId) patch.dealer_group_id = write.groupId;
    if (write.gstin) patch.gst_registration_id = await resolveGstRegistration(this.client, org, write.gstin);

    let dealerId = write.dealerId;
    if (dealerId) {
      const { error } = await this.client.from("dealers").update({ ...patch, updated_at: now }).eq("id", dealerId).eq("organisation_id", org);
      if (error) throw new ApiError(502, "DEALER_UPDATE_FAILED", "This dealer could not be updated");
    } else {
      const { data, error } = await this.client.from("dealers")
        .insert({ organisation_id: org, ...patch, account_state: "IMPORTED" }).select("id").maybeSingle();
      if (error?.code === "23505") throw new ApiError(409, "DEALER_CODE_TAKEN", "A dealer with this code was created while you were reviewing.");
      if (error || !data) throw new ApiError(502, "DEALER_CREATE_FAILED", "This dealer could not be created");
      dealerId = String(data.id);
    }

    if (write.isMainDealer && write.groupId) await syncMainDealer(this.client, org, write.groupId, dealerId);
    // One audit row per dealer rather than one per file: every row of the batch shares
    // this correlation id, so the batch is still reconstructable, and the dealer's own
    // trail stays complete. fileName is KITCO's, not dealer PII.
    await this.audit(session, correlationId, write.dealerId ? "DEALER_UPDATED" : "DEALER_IMPORTED", dealerId, { fields: write.fields, source: fileName, line: write.line });
  }
}

/** The address an issued OTP would go to. pilot_email first, then master_email, which
 *  is the order V5_AUTH_FLOW.md §8 sets for migrating the existing dealers. */
function loginEmailOf(row: Row): string | null {
  const email = row.pilot_email ?? row.master_email;
  return email ? String(email) : null;
}

/** Maps validated input onto database columns. Only the fields actually supplied are
 *  included, which is what makes a blank CSV cell mean "leave this alone". */
function dealerPatch(input: Partial<AdminDealerInput>): Row {
  const patch: Row = {};
  if (input.dealerCode !== undefined) patch.code = input.dealerCode;
  if (input.legalName !== undefined) patch.legal_name = input.legalName;
  if (input.displayName !== undefined) patch.display_name = input.displayName;
  if (input.addressLine1 !== undefined) patch.address_line1 = input.addressLine1;
  if (input.addressLine2 !== undefined) patch.address_line2 = input.addressLine2;
  if (input.city !== undefined) patch.city = input.city;
  if (input.state !== undefined) patch.state = input.state;
  if (input.pinCode !== undefined) patch.pin_code = input.pinCode;
  if (input.contactPerson !== undefined) patch.contact_person = input.contactPerson;
  if (input.mobile !== undefined) patch.mobile = input.mobile;
  if (input.primaryEmail !== undefined) patch.master_email = input.primaryEmail;
  if (input.secondaryEmail !== undefined) patch.secondary_email = input.secondaryEmail;
  if (input.isMainDealer !== undefined) patch.is_main_dealer = input.isMainDealer;
  // dealers.name is NOT NULL and is still what v4's console and CSV exports render, so
  // it tracks the v5 display name. Letting them diverge would mean renaming a dealer
  // here and having every existing screen keep showing the old name.
  const name = input.displayName ?? input.legalName;
  if (name !== undefined) patch.name = name;
  return patch;
}

/** CSV cells to the shape the zod schemas validate. Blank cells are dropped rather
 *  than passed as "", so an optional field the admin left empty stays untouched. */
function toInput(record: Record<string, string>, errors: string[]): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  const take = (column: ImportColumn, field: string) => { if (record[column]) input[field] = record[column]; };
  take("dealer_code", "dealerCode");
  take("legal_name", "legalName");
  take("display_name", "displayName");
  take("group_code", "groupCode");
  take("gstin", "gstin");
  take("address_line1", "addressLine1");
  take("address_line2", "addressLine2");
  take("city", "city");
  take("state", "state");
  take("pin_code", "pinCode");
  take("contact_person", "contactPerson");
  take("mobile", "mobile");
  take("primary_email", "primaryEmail");
  take("secondary_email", "secondaryEmail");
  const flag = (record.is_main_dealer ?? "").trim().toLowerCase();
  if (TRUE_WORDS.has(flag)) input.isMainDealer = true;
  else if (FALSE_WORDS.has(flag)) input.isMainDealer = false;
  else if (flag !== "") errors.push(`is_main_dealer: use yes or no, not "${record.is_main_dealer}".`);
  return input;
}

function fileError(line: number, message: string): DealerImportRowPlan {
  return { line, dealerCode: "", action: "ERROR", changes: [], errors: [message] };
}

function totalsOf(rows: DealerImportRowPlan[]): DealerImportPlan["totals"] {
  return {
    create: rows.filter((row) => row.action === "CREATE").length,
    update: rows.filter((row) => row.action === "UPDATE").length,
    skip: rows.filter((row) => row.action === "SKIP").length,
    error: rows.filter((row) => row.action === "ERROR").length,
  };
}

function cellAt(cells: string[], columns: string[], column: ImportColumn): string {
  const index = columns.indexOf(column);
  return index === -1 ? "" : (cells[index] ?? "").trim();
}
