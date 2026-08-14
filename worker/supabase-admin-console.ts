import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionIdentity } from "./middleware/auth";
import type {
  AdminConsoleReader, AuditRow, DashboardPayload, DealerRow, ImportJobRow,
  MediaPayload, OfferingRow, ProductRow, Row, SettingsPayload, SizeSetRow,
} from "./routes/admin-console";

/** Media kind the dealer catalogue actually renders. */
const DISPLAY_MEDIA_KIND = "WEBP_600";
const PENDING_REVIEW = ["SUBMITTED", "UNDER_REVIEW", "REVISION_REQUESTED"];

type AnyRow = Record<string, any>;

export class SupabaseAdminConsoleReader implements AdminConsoleReader {
  constructor(private readonly client: SupabaseClient) {}

  private scoped(table: string, organisationId: string, columns = "*") {
    return this.client.from(table).select(columns).eq("organisation_id", organisationId);
  }

  private async count(table: string, organisationId: string, apply?: (query: any) => any): Promise<number> {
    let query = this.client.from(table).select("id", { count: "exact", head: true }).eq("organisation_id", organisationId);
    if (apply) query = apply(query);
    const { count, error } = await query;
    if (error) throw new Error("ADMIN_CONSOLE_READ_FAILED");
    return count ?? 0;
  }

  private async rows(table: string, organisationId: string, columns: string, apply?: (query: any) => any): Promise<AnyRow[]> {
    let query = this.scoped(table, organisationId, columns);
    if (apply) query = apply(query);
    const { data, error } = await query;
    if (error) throw new Error("ADMIN_CONSOLE_READ_FAILED");
    return (data ?? []) as AnyRow[];
  }

  async dashboard(session: SessionIdentity): Promise<DashboardPayload> {
    const org = session.organisationId;
    const [totalOrders, pendingReview, approved, dealers, activeDealers, colourways, published] = await Promise.all([
      this.count("orders", org),
      this.count("orders", org, (q) => q.in("status", PENDING_REVIEW)),
      this.count("orders", org, (q) => q.eq("status", "APPROVED")),
      this.count("dealers", org),
      this.count("dealers", org, (q) => q.eq("activation_status", "ACTIVE")),
      this.count("product_colourways", org),
      this.count("product_colourways", org, (q) => q.not("published_at", "is", null)),
    ]);
    const [sizes, versions, media] = await Promise.all([
      this.rows("order_line_sizes", org, "ordered_quantity_pairs"),
      this.rows("order_versions", org, "retail_value_minor"),
      this.rows("product_media", org, "product_colourway_id", (q) => q.eq("media_kind", DISPLAY_MEDIA_KIND)),
    ]);
    return {
      orders: { total: totalOrders, pendingReview, approved },
      pairsOrdered: sizes.reduce((sum, row) => sum + Number(row.ordered_quantity_pairs ?? 0), 0),
      retailValueMinor: versions.reduce((sum, row) => sum + Number(row.retail_value_minor ?? 0), 0),
      dealers: { total: dealers, active: activeDealers },
      catalogue: { colourways, published, withMedia: new Set(media.map((row) => row.product_colourway_id)).size },
    };
  }

  async dealers(session: SessionIdentity): Promise<DealerRow[]> {
    const org = session.organisationId;
    const [dealers, locations, gst, orders] = await Promise.all([
      this.rows("dealers", org, "id,code,name,state,city,activation_status", (q) => q.order("name")),
      this.rows("dealer_locations", org, "dealer_id"),
      this.rows("dealer_gst_registrations", org, "dealer_id"),
      this.rows("orders", org, "dealer_id"),
    ]);
    const tally = (list: AnyRow[]) => list.reduce<Record<string, number>>((acc, row) => {
      const key = String(row.dealer_id);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    const locationCounts = tally(locations), gstCounts = tally(gst), orderCounts = tally(orders);
    return dealers.map((row) => ({
      id: String(row.id), code: row.code ?? null, name: String(row.name),
      state: row.state ?? null, city: row.city ?? null,
      activationStatus: String(row.activation_status),
      locations: locationCounts[String(row.id)] ?? 0,
      gstRegistrations: gstCounts[String(row.id)] ?? 0,
      orders: orderCounts[String(row.id)] ?? 0,
    }));
  }

  async products(session: SessionIdentity): Promise<ProductRow[]> {
    const org = session.organisationId;
    const [colourways, families, brands, media, offerings] = await Promise.all([
      this.rows("product_colourways", org, "id,article_no,colour,mrp_minor,published_at,product_family_id", (q) => q.order("article_no").limit(1000)),
      this.rows("product_families", org, "id,name,category,brand_id"),
      this.rows("brands", org, "id,name"),
      this.rows("product_media", org, "product_colourway_id", (q) => q.eq("media_kind", DISPLAY_MEDIA_KIND)),
      this.rows("commercial_offerings", org, "product_colourway_id,offering_type"),
    ]);
    const brandById = new Map(brands.map((row) => [String(row.id), String(row.name)]));
    const familyById = new Map(families.map((row) => [String(row.id), row]));
    const withMedia = new Set(media.map((row) => String(row.product_colourway_id)));
    const typesByColourway = offerings.reduce<Record<string, Set<string>>>((acc, row) => {
      const key = String(row.product_colourway_id);
      (acc[key] ??= new Set()).add(String(row.offering_type));
      return acc;
    }, {});
    return colourways.map((row) => {
      const family = familyById.get(String(row.product_family_id));
      return {
        id: String(row.id), articleNo: String(row.article_no), colour: row.colour ?? null,
        brand: family ? brandById.get(String(family.brand_id)) ?? null : null,
        family: family ? String(family.name) : null,
        category: family?.category ?? null,
        mrpMinor: row.mrp_minor ?? null,
        published: row.published_at !== null,
        hasMedia: withMedia.has(String(row.id)),
        offeringTypes: [...(typesByColourway[String(row.id)] ?? [])],
      };
    });
  }

  async offerings(session: SessionIdentity): Promise<OfferingRow[]> {
    const org = session.organisationId;
    const [offerings, colourways] = await Promise.all([
      this.rows("commercial_offerings", org, "id,product_colourway_id,offering_type,mrp_minor,moq_pairs,order_multiple,published_at", (q) => q.limit(1000)),
      this.rows("product_colourways", org, "id,article_no", (q) => q.limit(1000)),
    ]);
    const articleById = new Map(colourways.map((row) => [String(row.id), String(row.article_no)]));
    return offerings.map((row) => ({
      id: String(row.id),
      articleNo: articleById.get(String(row.product_colourway_id)) ?? "—",
      offeringType: String(row.offering_type),
      mrpMinor: row.mrp_minor ?? null,
      moqPairs: row.moq_pairs ?? null,
      orderMultiple: row.order_multiple ?? null,
      published: row.published_at !== null,
    }));
  }

  async seasons(session: SessionIdentity): Promise<Row[]> {
    return this.rows("seasons", session.organisationId, "id,code,name,starts_at,ends_at");
  }

  async schemes(session: SessionIdentity): Promise<Row[]> {
    return this.rows("schemes", session.organisationId, "id,code,name,starts_at,ends_at,published_at");
  }

  async sizeSets(session: SessionIdentity): Promise<SizeSetRow[]> {
    const org = session.organisationId;
    const [sets, values] = await Promise.all([
      this.rows("size_sets", org, "id,code,name", (q) => q.order("code")),
      this.rows("size_values", org, "size_set_id,label,sort_order", (q) => q.order("sort_order")),
    ]);
    return sets.map((row) => ({
      id: String(row.id), code: String(row.code), name: String(row.name),
      values: values.filter((value) => String(value.size_set_id) === String(row.id)).map((value) => String(value.label)),
    }));
  }

  async media(session: SessionIdentity): Promise<MediaPayload> {
    const org = session.organisationId;
    const [media, colourways] = await Promise.all([
      this.rows("product_media", org, "product_colourway_id,media_kind"),
      this.count("product_colourways", org),
    ]);
    const byKind = media.reduce<Record<string, number>>((acc, row) => {
      const kind = String(row.media_kind);
      acc[kind] = (acc[kind] ?? 0) + 1;
      return acc;
    }, {});
    const withDisplayMedia = new Set(
      media.filter((row) => String(row.media_kind) === DISPLAY_MEDIA_KIND).map((row) => String(row.product_colourway_id)),
    ).size;
    return {
      totals: { colourways, withDisplayMedia, missing: colourways - withDisplayMedia },
      byKind: Object.entries(byKind).map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
    };
  }

  async imports(session: SessionIdentity): Promise<ImportJobRow[]> {
    const org = session.organisationId;
    const [jobs, files, profiles, rows] = await Promise.all([
      this.rows("catalogue_import_jobs", org, "id,status,source_file_id,import_profile_id,committed_at,created_at", (q) => q.order("created_at", { ascending: false })),
      this.rows("source_files", org, "id,original_name"),
      this.rows("import_profiles", org, "id,code"),
      this.rows("catalogue_import_rows", org, "catalogue_import_job_id"),
    ]);
    const fileById = new Map(files.map((row) => [String(row.id), String(row.original_name)]));
    const profileById = new Map(profiles.map((row) => [String(row.id), String(row.code)]));
    const rowCounts = rows.reduce<Record<string, number>>((acc, row) => {
      const key = String(row.catalogue_import_job_id);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    return jobs.map((row) => ({
      id: String(row.id), status: String(row.status),
      sourceName: fileById.get(String(row.source_file_id)) ?? null,
      profileCode: profileById.get(String(row.import_profile_id)) ?? null,
      createdAt: String(row.created_at),
      committedAt: row.committed_at ?? null,
      rows: rowCounts[String(row.id)] ?? 0,
    }));
  }

  async dispatches(session: SessionIdentity): Promise<Row[]> {
    return this.rows("dispatches", session.organisationId, "id,order_id,dispatch_number,status,dispatched_at", (q) => q.order("created_at", { ascending: false }));
  }

  async holds(session: SessionIdentity): Promise<Row[]> {
    return this.rows("holds", session.organisationId, "id,order_id,hold_type,status,reason,released_at,created_at", (q) => q.order("created_at", { ascending: false }));
  }

  async audit(session: SessionIdentity): Promise<AuditRow[]> {
    const rows = await this.rows(
      "audit_events", session.organisationId,
      "id,event_type,entity_type,entity_id,correlation_id,occurred_at",
      (q) => q.order("occurred_at", { ascending: false }).limit(200),
    );
    return rows.map((row) => ({
      id: String(row.id), eventType: String(row.event_type),
      entityType: row.entity_type ?? null, entityId: row.entity_id ?? null,
      correlationId: row.correlation_id ?? null, occurredAt: String(row.occurred_at),
    }));
  }

  async settings(session: SessionIdentity): Promise<SettingsPayload> {
    const org = session.organisationId;
    const [organisation, brands, sizeSets, profiles] = await Promise.all([
      this.client.from("organisations").select("id,code,name").eq("id", org).maybeSingle(),
      this.rows("brands", org, "id,code,name,active", (q) => q.order("name")),
      this.count("size_sets", org),
      this.rows("import_profiles", org, "id,code,source_kind,active", (q) => q.order("code")),
    ]);
    const record = organisation.data as AnyRow | null;
    return {
      organisation: record ? { id: String(record.id), code: record.code ?? null, name: String(record.name) } : null,
      brands: brands.map((row) => ({ id: String(row.id), code: row.code ?? null, name: String(row.name), active: Boolean(row.active) })),
      sizeSets,
      importProfiles: profiles.map((row) => ({ id: String(row.id), code: String(row.code), sourceKind: row.source_kind ?? null, active: Boolean(row.active) })),
    };
  }
}
