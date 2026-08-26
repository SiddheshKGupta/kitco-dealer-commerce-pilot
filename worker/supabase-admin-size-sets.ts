import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionIdentity } from "./middleware/auth";
import { ApiError } from "./middleware/errors";
import type { SizeSetsAdmin, SizeSetsAdminPayload } from "./routes/admin-size-sets";

type AnyRow = Record<string, any>;
const UPSERT_CHUNK = 500;

export class SupabaseSizeSetsAdmin implements SizeSetsAdmin {
  constructor(private readonly client: SupabaseClient) {}

  private async audit(session: SessionIdentity, correlationId: string, eventType: string, entityId: string, evidence: Record<string, unknown>) {
    await this.client.from("audit_events").insert({
      organisation_id: session.organisationId,
      dealer_id: null,
      actor_auth_user_id: session.userId,
      event_type: eventType,
      entity_type: "size_set",
      entity_id: entityId,
      correlation_id: correlationId,
      evidence,
    });
  }

  async list(session: SessionIdentity): Promise<SizeSetsAdminPayload> {
    const org = session.organisationId;
    const [sets, values, families, brands, colourways, enabledUsage, sizeSystems] = await Promise.all([
      this.client.from("size_sets").select("id,code,name,size_system_id").eq("organisation_id", org).order("code"),
      this.client.from("size_values").select("id,size_set_id,label,sort_order").eq("organisation_id", org).order("sort_order"),
      this.client.from("product_families").select("id,brand_id,gender,name,family_key").eq("organisation_id", org),
      this.client.from("brands").select("id,name").eq("organisation_id", org),
      this.client.from("product_colourways").select("id,product_family_id").eq("organisation_id", org),
      this.client.from("product_size_values").select("product_colourway_id,size_value_id").eq("organisation_id", org).eq("enabled", true),
      this.client.from("size_systems").select("id,code,label").eq("organisation_id", org).order("label"),
    ]);
    for (const result of [sets, values, families, brands, colourways, enabledUsage, sizeSystems]) {
      if (result.error) throw new ApiError(502, "SIZE_SETS_LOAD_FAILED", "Size sets could not be loaded");
    }
    const systemById = new Map((sizeSystems.data ?? []).map((row: AnyRow) => [String(row.id), String(row.label)]));

    const brandById = new Map((brands.data ?? []).map((row: AnyRow) => [String(row.id), String(row.name)]));
    const familyById = new Map((families.data ?? []).map((row: AnyRow) => [String(row.id), row]));
    const setById = new Map((sets.data ?? []).map((row: AnyRow) => [String(row.id), row]));
    const valueById = new Map((values.data ?? []).map((row: AnyRow) => [String(row.id), row]));
    const colourwayFamilyId = new Map((colourways.data ?? []).map((row: AnyRow) => [String(row.id), String(row.product_family_id)]));

    const usageCounts = (enabledUsage.data ?? []).reduce<Record<string, number>>((acc, row: AnyRow) => {
      const key = String(row.size_value_id);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    const sizeSets = (sets.data ?? []).map((set: AnyRow) => ({
      id: String(set.id), code: String(set.code), name: String(set.name),
      sizeSystemId: set.size_system_id ? String(set.size_system_id) : null,
      sizeSystemLabel: set.size_system_id ? (systemById.get(String(set.size_system_id)) ?? null) : null,
      values: (values.data ?? [])
        .filter((value: AnyRow) => String(value.size_set_id) === String(set.id))
        .map((value: AnyRow) => ({ id: String(value.id), label: String(value.label), sortOrder: Number(value.sort_order), inUseCount: usageCounts[String(value.id)] ?? 0 })),
    }));

    const familyOptions = (families.data ?? []).map((row: AnyRow) => ({
      id: String(row.id), brandId: String(row.brand_id),
      brandName: brandById.get(String(row.brand_id)) ?? "Unknown brand",
      gender: String(row.gender ?? "UNSPECIFIED"), name: String(row.name ?? row.family_key),
    }));

    // "What's assigned today" is derived live from which sizes are actually turned on
    // per colourway -- there's no separate stored default to go stale against reality.
    const groups = new Map<string, { brandName: string; gender: string; sizeSetId: string; colourwayIds: Set<string> }>();
    for (const usage of enabledUsage.data ?? []) {
      const familyId = colourwayFamilyId.get(String(usage.product_colourway_id));
      const family = familyId ? familyById.get(familyId) : undefined;
      const value = valueById.get(String(usage.size_value_id));
      if (!family || !value) continue;
      const brandName = brandById.get(String(family.brand_id)) ?? "Unknown brand";
      const gender = String(family.gender ?? "UNSPECIFIED");
      const sizeSetId = String(value.size_set_id);
      const key = `${brandName}::${gender}::${sizeSetId}`;
      const group = groups.get(key) ?? { brandName, gender, sizeSetId, colourwayIds: new Set<string>() };
      group.colourwayIds.add(String(usage.product_colourway_id));
      groups.set(key, group);
    }
    const assignments = [...groups.values()]
      .map((group) => {
        const set = setById.get(group.sizeSetId);
        return {
          brandName: group.brandName, gender: group.gender,
          sizeSetCode: set ? String(set.code) : null, sizeSetName: set ? String(set.name) : null,
          colourwayCount: group.colourwayIds.size,
        };
      })
      .sort((a, b) => a.brandName.localeCompare(b.brandName) || a.gender.localeCompare(b.gender));

    return {
      sizeSets, families: familyOptions, assignments,
      sizeSystems: (sizeSystems.data ?? []).map((row: AnyRow) => ({ id: String(row.id), code: String(row.code), label: String(row.label) })),
    };
  }

  async createSet(session: SessionIdentity, code: string, name: string, correlationId: string): Promise<{ id: string }> {
    const { data, error } = await this.client.from("size_sets")
      .insert({ organisation_id: session.organisationId, code, name }).select("id").single();
    if (error) {
      if (error.code === "23505") throw new ApiError(409, "SIZE_SET_CODE_TAKEN", "A size set with this code already exists");
      throw new ApiError(502, "SIZE_SET_CREATE_FAILED", "Size set could not be created");
    }
    await this.audit(session, correlationId, "SIZE_SET_CREATED", String(data.id), { code, name });
    return { id: String(data.id) };
  }

  async createValue(session: SessionIdentity, sizeSetId: string, label: string, sortOrder: number, correlationId: string): Promise<{ id: string }> {
    const { data: set } = await this.client.from("size_sets").select("id")
      .eq("id", sizeSetId).eq("organisation_id", session.organisationId).maybeSingle();
    if (!set) throw new ApiError(404, "SIZE_SET_NOT_FOUND", "Size set not found");
    const { data, error } = await this.client.from("size_values")
      .insert({ organisation_id: session.organisationId, size_set_id: sizeSetId, label, sort_order: sortOrder })
      .select("id").single();
    if (error) {
      if (error.code === "23505") throw new ApiError(409, "SIZE_VALUE_LABEL_TAKEN", "This size already exists in the set");
      throw new ApiError(502, "SIZE_VALUE_CREATE_FAILED", "Size value could not be created");
    }
    await this.audit(session, correlationId, "SIZE_VALUE_CREATED", String(data.id), { sizeSetId, label, sortOrder });
    return { id: String(data.id) };
  }

  async updateValue(session: SessionIdentity, valueId: string, changes: { label?: string; sortOrder?: number }, correlationId: string): Promise<void> {
    const { data: value } = await this.client.from("size_values").select("id")
      .eq("id", valueId).eq("organisation_id", session.organisationId).maybeSingle();
    if (!value) throw new ApiError(404, "SIZE_VALUE_NOT_FOUND", "Size value not found");
    const patch: AnyRow = {};
    if (changes.label !== undefined) patch.label = changes.label;
    if (changes.sortOrder !== undefined) patch.sort_order = changes.sortOrder;
    const { error } = await this.client.from("size_values").update(patch).eq("id", valueId);
    if (error) {
      if (error.code === "23505") throw new ApiError(409, "SIZE_VALUE_LABEL_TAKEN", "This size already exists in the set");
      throw new ApiError(502, "SIZE_VALUE_UPDATE_FAILED", "Size value could not be updated");
    }
    await this.audit(session, correlationId, "SIZE_VALUE_UPDATED", valueId, patch);
  }

  /** Blocks outright rather than soft-deleting: a size a dealer already ordered must
   *  keep pointing at a real size_values row forever, so removal is refused whenever
   *  any product or order history still references it (see task-8 brief). Admins
   *  needing a size gone from new orders should turn it off per product instead. */
  async removeValue(session: SessionIdentity, valueId: string, correlationId: string): Promise<void> {
    const { data: value } = await this.client.from("size_values").select("id,label")
      .eq("id", valueId).eq("organisation_id", session.organisationId).maybeSingle();
    if (!value) throw new ApiError(404, "SIZE_VALUE_NOT_FOUND", "Size value not found");
    const [productUsage, orderUsage, draftUsage] = await Promise.all([
      this.client.from("product_size_values").select("id", { count: "exact", head: true }).eq("size_value_id", valueId),
      this.client.from("order_line_sizes").select("id", { count: "exact", head: true }).eq("size_value_id", valueId),
      this.client.from("draft_order_line_sizes").select("id", { count: "exact", head: true }).eq("size_value_id", valueId),
    ]);
    if (productUsage.error || orderUsage.error || draftUsage.error) throw new ApiError(502, "SIZE_VALUE_DELETE_FAILED", "Size value could not be checked for use");
    if ((productUsage.count ?? 0) > 0 || (orderUsage.count ?? 0) > 0 || (draftUsage.count ?? 0) > 0) {
      throw new ApiError(409, "SIZE_VALUE_IN_USE", `Size ${value.label} is in use by products or orders and can't be removed. Turn it off for the individual product instead.`);
    }
    const { error } = await this.client.from("size_values").delete().eq("id", valueId);
    if (error) throw new ApiError(502, "SIZE_VALUE_DELETE_FAILED", "Size value could not be removed");
    await this.audit(session, correlationId, "SIZE_VALUE_REMOVED", valueId, { label: value.label });
  }

  async assign(session: SessionIdentity, input: { sizeSetId: string; familyId: string } | { sizeSetId: string; brandId: string; gender: string }, correlationId: string): Promise<{ colourwaysAffected: number }> {
    const org = session.organisationId;
    const { data: set } = await this.client.from("size_sets").select("id,code")
      .eq("id", input.sizeSetId).eq("organisation_id", org).maybeSingle();
    if (!set) throw new ApiError(404, "SIZE_SET_NOT_FOUND", "Size set not found");

    let familyIds: string[];
    if ("familyId" in input) {
      const { data: family } = await this.client.from("product_families").select("id")
        .eq("id", input.familyId).eq("organisation_id", org).maybeSingle();
      if (!family) throw new ApiError(404, "PRODUCT_FAMILY_NOT_FOUND", "Product family not found");
      familyIds = [String(family.id)];
    } else {
      const { data: matchedFamilies, error } = await this.client.from("product_families").select("id")
        .eq("organisation_id", org).eq("brand_id", input.brandId).eq("gender", input.gender);
      if (error) throw new ApiError(502, "SIZE_SET_ASSIGN_FAILED", "Product families could not be loaded");
      familyIds = (matchedFamilies ?? []).map((row: AnyRow) => String(row.id));
      if (familyIds.length === 0) throw new ApiError(404, "NO_MATCHING_PRODUCTS", "No products match this brand and gender");
    }

    const [{ data: colourways, error: colourwaysError }, { data: values, error: valuesError }] = await Promise.all([
      this.client.from("product_colourways").select("id").eq("organisation_id", org).in("product_family_id", familyIds),
      this.client.from("size_values").select("id").eq("size_set_id", input.sizeSetId),
    ]);
    if (colourwaysError) throw new ApiError(502, "SIZE_SET_ASSIGN_FAILED", "Products could not be loaded");
    if (valuesError) throw new ApiError(502, "SIZE_SET_ASSIGN_FAILED", "Size values could not be loaded");
    const colourwayIds = (colourways ?? []).map((row: AnyRow) => String(row.id));
    const valueIds = (values ?? []).map((row: AnyRow) => String(row.id));
    if (colourwayIds.length === 0 || valueIds.length === 0) return { colourwaysAffected: 0 };

    // Additive only (see class doc): existing rows -- including ones an admin already
    // disabled for a specific product -- are left exactly as they are.
    const rows = colourwayIds.flatMap((colourwayId) => valueIds.map((valueId) => ({
      organisation_id: org, product_colourway_id: colourwayId, size_value_id: valueId, enabled: true,
    })));
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      const { error } = await this.client.from("product_size_values")
        .upsert(rows.slice(i, i + UPSERT_CHUNK), { onConflict: "product_colourway_id,size_value_id", ignoreDuplicates: true });
      if (error) throw new ApiError(502, "SIZE_SET_ASSIGN_FAILED", "Size set could not be assigned");
    }

    await this.audit(session, correlationId, "SIZE_SET_ASSIGNED", input.sizeSetId, { ...input, colourwaysAffected: colourwayIds.length });
    return { colourwaysAffected: colourwayIds.length };
  }

  async setSizeSystem(session: SessionIdentity, sizeSetId: string, sizeSystemId: string | null, correlationId: string): Promise<void> {
    const org = session.organisationId;
    const { data: set } = await this.client.from("size_sets").select("id")
      .eq("id", sizeSetId).eq("organisation_id", org).maybeSingle();
    if (!set) throw new ApiError(404, "SIZE_SET_NOT_FOUND", "Size set not found");
    if (sizeSystemId) {
      const { data: system } = await this.client.from("size_systems").select("id")
        .eq("id", sizeSystemId).eq("organisation_id", org).maybeSingle();
      if (!system) throw new ApiError(404, "SIZE_SYSTEM_NOT_FOUND", "Size system not found");
    }
    const { error } = await this.client.from("size_sets").update({ size_system_id: sizeSystemId }).eq("id", sizeSetId);
    if (error) throw new ApiError(502, "SIZE_SET_UPDATE_FAILED", "Size system could not be saved");
    await this.audit(session, correlationId, "SIZE_SET_SIZE_SYSTEM_SET", sizeSetId, { sizeSystemId });
  }

  async createSizeSystem(session: SessionIdentity, code: string, label: string, correlationId: string): Promise<{ id: string }> {
    const { data, error } = await this.client.from("size_systems")
      .insert({ organisation_id: session.organisationId, code, label }).select("id").single();
    if (error) {
      if (error.code === "23505") throw new ApiError(409, "SIZE_SYSTEM_CODE_TAKEN", "A size system with this code already exists");
      throw new ApiError(502, "SIZE_SYSTEM_CREATE_FAILED", "Size system could not be created");
    }
    await this.audit(session, correlationId, "SIZE_SYSTEM_CREATED", String(data.id), { code, label });
    return { id: String(data.id) };
  }
}
