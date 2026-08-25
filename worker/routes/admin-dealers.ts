import type { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables, SessionIdentity } from "../middleware/auth";
import { csvEscape } from "./admin-export";
import { parseBody } from "./shared";

/** One dealer as the onboarding console needs it. `accountState` is returned raw --
 *  null when the v5 column has never been written for this dealer -- rather than
 *  defaulted to IMPORTED for display. The machine treats null as IMPORTED, but the
 *  console must not show a value the database does not hold. */
export interface AdminDealerRow {
  id: string;
  dealerCode: string;
  legalName: string | null;
  displayName: string;
  groupCode: string | null;
  gstin: string | null;
  city: string | null;
  state: string | null;
  isMainDealer: boolean;
  accountState: string | null;
  credentialsIssuedAt: string | null;
  firstLoginAt: string | null;
  lastLoginAt: string | null;
  /** The address an issued OTP would go to, or null when there is nothing to send to. */
  loginEmail: string | null;
}

export interface AdminDealerInput {
  dealerCode: string;
  legalName: string;
  displayName?: string;
  groupCode?: string;
  gstin?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  pinCode?: string;
  contactPerson?: string;
  mobile?: string;
  primaryEmail?: string;
  secondaryEmail?: string;
  isMainDealer?: boolean;
}

/** Shown to the admin once and never persisted (V5_AUTH_FLOW.md §6): KITCO passes it
 *  to the dealer out of band, and first login forces it to be replaced. */
export interface IssuedCredentials {
  dealerId: string;
  dealerCode: string;
  loginEmail: string;
  password: string;
  accountState: string;
  credentialsIssuedAt: string;
  /** True when this dealer already had a login and its password was replaced. */
  reissued: boolean;
}

export type DealerImportAction = "CREATE" | "UPDATE" | "SKIP" | "ERROR";

export interface DealerImportRowPlan {
  /** 1-based line in the uploaded file, header included, so an error points at a row
   *  the admin can actually find in their spreadsheet. */
  line: number;
  dealerCode: string;
  action: DealerImportAction;
  /** Column names that would change. Never the values -- same rule as the audit log. */
  changes: string[];
  errors: string[];
}

export interface DealerImportPlan {
  rows: DealerImportRowPlan[];
  totals: { create: number; update: number; skip: number; error: number };
  /** False for a preview. The preview writes nothing at all. */
  committed: boolean;
}

export interface AdminDealersStore {
  list(session: SessionIdentity): Promise<AdminDealerRow[]>;
  create(session: SessionIdentity, input: AdminDealerInput, correlationId: string): Promise<AdminDealerRow>;
  issueCredentials(session: SessionIdentity, dealerId: string, correlationId: string): Promise<IssuedCredentials>;
  setAccountState(session: SessionIdentity, dealerId: string, action: AccountStateAction, correlationId: string): Promise<AdminDealerRow>;
  previewImport(session: SessionIdentity, csv: string): Promise<DealerImportPlan>;
  commitImport(session: SessionIdentity, csv: string, fileName: string, correlationId: string): Promise<DealerImportPlan>;
}

/** Admin intents, not raw target states: RESTORE's destination depends on whether the
 *  dealer ever completed a first login, and that decision belongs in the machine. */
export type AccountStateAction = "SUSPEND" | "DISABLE" | "RESTORE";

// --------------------------------------------------------------------------- CSV
/** The import contract. Column order is the template's order; the parser matches on
 *  header name, so an admin who reorders columns in Excel still imports cleanly. */
export const IMPORT_COLUMNS = [
  "dealer_code",
  "legal_name",
  "display_name",
  "group_code",
  "gstin",
  "address_line1",
  "address_line2",
  "city",
  "state",
  "pin_code",
  "contact_person",
  "mobile",
  "primary_email",
  "secondary_email",
  "is_main_dealer",
] as const;

export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

/** One filled example row, because an empty template invites guesswork about which
 *  columns are required and what a GSTIN or a yes/no flag is meant to look like. */
const TEMPLATE_EXAMPLE: Record<ImportColumn, string> = {
  dealer_code: "BIHAR-0001",
  legal_name: "SHREE GANESH FOOTWEAR PRIVATE LIMITED",
  display_name: "Shree Ganesh Footwear",
  group_code: "GANESH",
  gstin: "10AXYPJ2171Q1ZX",
  address_line1: "Tower Chowk, Saraiyaganj",
  address_line2: "Ward No 11",
  city: "Muzaffarpur",
  state: "Bihar",
  pin_code: "842001",
  contact_person: "Ramesh Kumar",
  mobile: "9006875566",
  primary_email: "orders@shreeganesh.example",
  secondary_email: "",
  is_main_dealer: "yes",
};

export function importTemplateCsv(): string {
  return [
    IMPORT_COLUMNS.join(","),
    IMPORT_COLUMNS.map((column) => csvEscape(TEMPLATE_EXAMPLE[column])).join(","),
  ].join("\r\n");
}

/** RFC 4180 as far as a spreadsheet export actually goes: quoted fields, embedded
 *  commas and newlines, "" for a literal quote, CRLF or LF. Deliberately lenient
 *  about malformed quoting -- a mangled cell fails row validation with a message the
 *  admin can act on, which beats rejecting the whole file on a parse error. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;

  const endRow = () => { row.push(field); rows.push(row); row = []; field = ""; started = false; };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character !== '"') field += character;
      else if (text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = false;
      continue;
    }
    if (character === '"' && field === "") { quoted = true; started = true; }
    else if (character === ",") { row.push(field); field = ""; started = true; }
    else if (character === "\n") { if (started || field !== "") endRow(); }
    else if (character !== "\r") { field += character; started = true; }
  }
  if (started || field !== "") endRow();
  return rows;
}

// ------------------------------------------------------------------------ schemas
// Live dealer codes look like BIHAR-0001, so hyphens and underscores are in.
const dealerCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,39}$/, "Use letters, numbers, hyphens and underscores, 2-40 characters");
const groupCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,40}$/, "Use letters, numbers and underscores only, 2-40 characters");
const gstinSchema = z.string().trim().toUpperCase().regex(/^[0-9A-Z]{15}$/u, "A GST number is 15 letters and digits");
const text = (max: number) => z.string().trim().min(1).max(max);

const dealerShape = {
  dealerCode: dealerCodeSchema,
  legalName: text(200),
  displayName: text(200).optional(),
  groupCode: groupCodeSchema.optional(),
  gstin: gstinSchema.optional(),
  addressLine1: text(200).optional(),
  addressLine2: text(200).optional(),
  city: text(100).optional(),
  state: text(100).optional(),
  pinCode: z.string().trim().regex(/^[0-9]{6}$/u, "A PIN code is 6 digits").optional(),
  contactPerson: text(120).optional(),
  mobile: z.string().trim().regex(/^[0-9]{10}$/u, "A mobile number is 10 digits").optional(),
  primaryEmail: z.string().trim().toLowerCase().email().optional(),
  secondaryEmail: z.string().trim().toLowerCase().email().optional(),
  isMainDealer: z.boolean().optional(),
};

export const createDealerSchema = z.object(dealerShape).strict();

/** An import row against a dealer that already exists. Identical to the create schema
 *  except that legal_name may be blank: a bulk file that only corrects mobile numbers
 *  must not force the admin to re-export every statutory name to be accepted. Every
 *  other column is already optional, and a blank cell always means "leave this alone",
 *  never "clear this" -- in a spreadsheet a blank is an omission far more often than
 *  it is a deliberate erasure. */
export const updateDealerSchema = z.object({ ...dealerShape, legalName: text(200).optional() }).strict();

const accountStateSchema = z.object({ action: z.enum(["SUSPEND", "DISABLE", "RESTORE"]) }).strict();
// 2 MB of CSV is roughly 10k dealers -- far past any real import, and a bound so a
// pasted binary cannot become a parse loop over tens of megabytes.
const importSchema = z.object({
  csv: z.string().min(1).max(2_000_000),
  fileName: z.string().trim().max(200).optional(),
}).strict();

export function registerAdminDealerRoutes(app: Hono<{ Variables: AuthVariables }>, store?: AdminDealersStore): void {
  if (!store) return;

  // Literal paths first: Hono matches in registration order, and a later
  // /api/admin/dealers/:dealerId/... would otherwise swallow "import" as a dealer id
  // (the same hazard documented in app.ts for /api/orders/:orderId).
  app.get("/api/admin/dealers/import/template.csv", (context) => {
    context.header("Content-Type", "text/csv; charset=utf-8");
    context.header("Content-Disposition", 'attachment; filename="kitco-dealer-import-template.csv"');
    return context.body(importTemplateCsv());
  });

  app.post("/api/admin/dealers/import/preview", async (context) => {
    const input = await parseBody(context, importSchema);
    return context.json(await store.previewImport(context.get("session"), input.csv));
  });

  app.post("/api/admin/dealers/import/commit", async (context) => {
    const input = await parseBody(context, importSchema);
    const result = await store.commitImport(context.get("session"), input.csv, input.fileName ?? "dealer-import.csv", context.get("correlationId"));
    return context.json(result);
  });

  app.get("/api/admin/dealers", async (context) => context.json({ dealers: await store.list(context.get("session")) }));

  app.post("/api/admin/dealers", async (context) => {
    const input = await parseBody(context, createDealerSchema);
    return context.json(await store.create(context.get("session"), input, context.get("correlationId")), 201);
  });

  app.post("/api/admin/dealers/:dealerId/credentials", async (context) => {
    const issued = await store.issueCredentials(context.get("session"), context.req.param("dealerId"), context.get("correlationId"));
    return context.json(issued, 201);
  });

  app.post("/api/admin/dealers/:dealerId/account-state", async (context) => {
    const input = await parseBody(context, accountStateSchema);
    return context.json(await store.setAccountState(context.get("session"), context.req.param("dealerId"), input.action, context.get("correlationId")));
  });
}
