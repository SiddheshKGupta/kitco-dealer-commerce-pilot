import type { Hono } from "hono";
import type { AuthVariables, SessionIdentity } from "../middleware/auth";

/** Read-only projections backing KITCO Control. Every value is read live from the
 *  system of record; sections with no data return empty lists, never placeholders. */
export interface AdminConsoleReader {
  dashboard(session: SessionIdentity): Promise<DashboardPayload>;
  dealers(session: SessionIdentity): Promise<DealerRow[]>;
  products(session: SessionIdentity): Promise<ProductRow[]>;
  offerings(session: SessionIdentity): Promise<OfferingRow[]>;
  seasons(session: SessionIdentity): Promise<Row[]>;
  schemes(session: SessionIdentity): Promise<Row[]>;
  sizeSets(session: SessionIdentity): Promise<SizeSetRow[]>;
  media(session: SessionIdentity): Promise<MediaPayload>;
  imports(session: SessionIdentity): Promise<ImportJobRow[]>;
  dispatches(session: SessionIdentity): Promise<Row[]>;
  holds(session: SessionIdentity): Promise<Row[]>;
  audit(session: SessionIdentity): Promise<AuditRow[]>;
  settings(session: SessionIdentity): Promise<SettingsPayload>;
}

export type Row = Record<string, unknown>;

export interface DashboardPayload {
  orders: { total: number; pendingReview: number; approved: number };
  pairsOrdered: number;
  retailValueMinor: number;
  dealers: { total: number; active: number };
  catalogue: { colourways: number; published: number; withMedia: number };
}
export interface DealerRow {
  id: string; code: string | null; name: string; state: string | null; city: string | null;
  activationStatus: string; locations: number; gstRegistrations: number; orders: number;
}
export interface ProductRow {
  id: string; articleNo: string; colour: string | null; brand: string | null; family: string | null;
  category: string | null; mrpMinor: number | null; published: boolean; hasMedia: boolean; offeringTypes: string[];
}
export interface OfferingRow {
  id: string; articleNo: string; offeringType: string; mrpMinor: number | null;
  moqPairs: number | null; orderMultiple: number | null; published: boolean;
}
export interface SizeSetRow { id: string; code: string; name: string; values: string[] }
export interface MediaPayload {
  totals: { colourways: number; withDisplayMedia: number; missing: number };
  byKind: Array<{ kind: string; count: number }>;
}
export interface ImportJobRow {
  id: string; status: string; sourceName: string | null; profileCode: string | null;
  createdAt: string; committedAt: string | null; rows: number;
}
export interface AuditRow {
  id: string; eventType: string; entityType: string | null; entityId: string | null;
  correlationId: string | null; occurredAt: string; actorEmail: string | null;
}
export interface SettingsPayload {
  organisation: { id: string; code: string | null; name: string } | null;
  brands: Array<{ id: string; code: string | null; name: string; active: boolean }>;
  sizeSets: number;
  importProfiles: Array<{ id: string; code: string; sourceKind: string | null; active: boolean }>;
}

export function registerAdminConsoleRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  reader?: AdminConsoleReader,
): void {
  if (!reader) return;
  const section = <T>(path: string, load: (session: SessionIdentity) => Promise<T>) =>
    app.get(`/api/admin/console/${path}`, async (context) => context.json(await load(context.get("session"))));

  section("dashboard", (s) => reader.dashboard(s));
  section("dealers", async (s) => ({ dealers: await reader.dealers(s) }));
  section("products", async (s) => ({ products: await reader.products(s) }));
  section("offerings", async (s) => ({ offerings: await reader.offerings(s) }));
  section("seasons", async (s) => ({ seasons: await reader.seasons(s) }));
  section("schemes", async (s) => ({ schemes: await reader.schemes(s) }));
  section("size-sets", async (s) => ({ sizeSets: await reader.sizeSets(s) }));
  section("media", (s) => reader.media(s));
  section("imports", async (s) => ({ imports: await reader.imports(s) }));
  section("dispatches", async (s) => ({ dispatches: await reader.dispatches(s) }));
  section("holds", async (s) => ({ holds: await reader.holds(s) }));
  section("audit", async (s) => ({ audit: await reader.audit(s) }));
  section("settings", (s) => reader.settings(s));
}
