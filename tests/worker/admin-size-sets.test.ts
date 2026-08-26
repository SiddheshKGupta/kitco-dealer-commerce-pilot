import { describe, expect, it } from "vitest";
import { createCommerceApp } from "../../worker/app";
import type { SizeSetsAdmin, SizeSetsAdminPayload } from "../../worker/routes/admin-size-sets";
import { admin, dealerA, headers, repository, verifier } from "./fixtures";

/** In-memory double for SizeSetsAdmin -- exercises the route layer (zod validation,
 *  admin-only access, status codes) without touching Supabase. */
class FakeSizeSetsAdmin implements SizeSetsAdmin {
  sets = new Map<string, { id: string; code: string; name: string; sizeSystemId: string | null }>([
    ["set-1", { id: "set-1", code: "REEBOK_7_12", name: "Reebok 7 12", sizeSystemId: null }],
  ]);
  sizeSystems = new Map<string, { id: string; code: string; label: string }>([
    ["sys-us", { id: "sys-us", code: "US", label: "US" }],
  ]);
  setSizeSystemCalls: unknown[] = [];
  values = new Map<string, { id: string; sizeSetId: string; label: string; sortOrder: number; inUse: boolean }>([
    ["value-1", { id: "value-1", sizeSetId: "set-1", label: "12", sortOrder: 5, inUse: true }],
    ["value-2", { id: "value-2", sizeSetId: "set-1", label: "11", sortOrder: 4, inUse: false }],
  ]);
  assignCalls: unknown[] = [];

  async list(): Promise<SizeSetsAdminPayload> {
    return {
      sizeSets: [...this.sets.values()].map((set) => ({
        id: set.id, code: set.code, name: set.name,
        sizeSystemId: set.sizeSystemId, sizeSystemLabel: set.sizeSystemId ? (this.sizeSystems.get(set.sizeSystemId)?.label ?? null) : null,
        values: [...this.values.values()].filter((v) => v.sizeSetId === set.id)
          .map((v) => ({ id: v.id, label: v.label, sortOrder: v.sortOrder, inUseCount: v.inUse ? 3 : 0 })),
      })),
      families: [{ id: "family-1", brandId: "brand-1", brandName: "Reebok", gender: "MENS", name: "Reebok Classic" }],
      assignments: [{ brandName: "Reebok", gender: "MENS", sizeSetCode: "REEBOK_7_12", sizeSetName: "Reebok 7 12", colourwayCount: 77 }],
      sizeSystems: [...this.sizeSystems.values()],
    };
  }

  async createSet(_session: unknown, code: string, name: string): Promise<{ id: string }> {
    const id = `set-${this.sets.size + 1}`;
    this.sets.set(id, { id, code, name, sizeSystemId: null });
    return { id };
  }

  async createValue(_session: unknown, sizeSetId: string, label: string, sortOrder: number): Promise<{ id: string }> {
    const id = `value-${this.values.size + 1}`;
    this.values.set(id, { id, sizeSetId, label, sortOrder, inUse: false });
    return { id };
  }

  async updateValue(_session: unknown, valueId: string, changes: { label?: string; sortOrder?: number }): Promise<void> {
    const value = this.values.get(valueId);
    if (!value) throw new Error("NOT_FOUND");
    if (changes.label !== undefined) value.label = changes.label;
    if (changes.sortOrder !== undefined) value.sortOrder = changes.sortOrder;
  }

  async removeValue(_session: unknown, valueId: string): Promise<void> {
    const value = this.values.get(valueId);
    if (!value) throw new Error("NOT_FOUND");
    if (value.inUse) {
      const { ApiError } = await import("../../worker/middleware/errors");
      throw new ApiError(409, "SIZE_VALUE_IN_USE", `Size ${value.label} is in use by products or orders and can't be removed.`);
    }
    this.values.delete(valueId);
  }

  async assign(_session: unknown, input: unknown): Promise<{ colourwaysAffected: number }> {
    this.assignCalls.push(input);
    return { colourwaysAffected: 42 };
  }

  async setSizeSystem(_session: unknown, sizeSetId: string, sizeSystemId: string | null): Promise<void> {
    this.setSizeSystemCalls.push({ sizeSetId, sizeSystemId });
    const set = this.sets.get(sizeSetId);
    if (!set) { const { ApiError } = await import("../../worker/middleware/errors"); throw new ApiError(404, "SIZE_SET_NOT_FOUND", "Size set not found"); }
    set.sizeSystemId = sizeSystemId;
  }

  async createSizeSystem(_session: unknown, code: string, label: string): Promise<{ id: string }> {
    const id = `sys-${this.sizeSystems.size + 1}`;
    this.sizeSystems.set(id, { id, code, label });
    return { id };
  }
}

describe("admin size-sets routes", () => {
  it("denies dealer access", async () => {
    const app = createCommerceApp({ repository: repository(), verifySession: verifier({ a: dealerA }), sizeSetsAdmin: new FakeSizeSetsAdmin() });
    const response = await app.request("/api/admin/size-sets", { headers: headers("a") });
    expect(response.status).toBe(403);
  });

  it("lists size sets with values, families and live assignments", async () => {
    const app = createCommerceApp({ repository: repository(), verifySession: verifier({ admin }), sizeSetsAdmin: new FakeSizeSetsAdmin() });
    const response = await app.request("/api/admin/size-sets", { headers: headers("admin") });
    expect(response.status).toBe(200);
    const body = await response.json() as SizeSetsAdminPayload;
    expect(body.sizeSets[0]).toMatchObject({ code: "REEBOK_7_12", values: expect.arrayContaining([expect.objectContaining({ label: "12", inUseCount: 3 })]) });
    expect(body.assignments).toEqual([{ brandName: "Reebok", gender: "MENS", sizeSetCode: "REEBOK_7_12", sizeSetName: "Reebok 7 12", colourwayCount: 77 }]);
  });

  it("validates and creates a size set, then adds a size value to it", async () => {
    const fake = new FakeSizeSetsAdmin();
    const app = createCommerceApp({ repository: repository(), verifySession: verifier({ admin }), sizeSetsAdmin: fake });

    const invalid = await app.request("/api/admin/size-sets", { method: "POST", headers: headers("admin"), body: JSON.stringify({ code: "bad code!", name: "X" }) });
    expect(invalid.status).toBe(400);

    const created = await app.request("/api/admin/size-sets", { method: "POST", headers: headers("admin"), body: JSON.stringify({ code: "nike_men", name: "Nike Men 7 13" }) });
    expect(created.status).toBe(201);
    const { id } = await created.json() as { id: string };
    expect(fake.sets.get(id)?.code).toBe("NIKE_MEN");

    const valueCreated = await app.request(`/api/admin/size-sets/${id}/values`, { method: "POST", headers: headers("admin"), body: JSON.stringify({ label: "13", sortOrder: 6 }) });
    expect(valueCreated.status).toBe(201);
  });

  it("updates a size value", async () => {
    const fake = new FakeSizeSetsAdmin();
    const app = createCommerceApp({ repository: repository(), verifySession: verifier({ admin }), sizeSetsAdmin: fake });
    const response = await app.request("/api/admin/size-sets/values/value-2", { method: "PATCH", headers: headers("admin"), body: JSON.stringify({ sortOrder: 9 }) });
    expect(response.status).toBe(200);
    expect(fake.values.get("value-2")?.sortOrder).toBe(9);
  });

  it("blocks removing a size value that's still in use, and allows removing one that isn't", async () => {
    const fake = new FakeSizeSetsAdmin();
    const app = createCommerceApp({ repository: repository(), verifySession: verifier({ admin }), sizeSetsAdmin: fake });

    const blocked = await app.request("/api/admin/size-sets/values/value-1", { method: "DELETE", headers: headers("admin") });
    expect(blocked.status).toBe(409);
    expect(fake.values.has("value-1")).toBe(true);

    const removed = await app.request("/api/admin/size-sets/values/value-2", { method: "DELETE", headers: headers("admin") });
    expect(removed.status).toBe(200);
    expect(fake.values.has("value-2")).toBe(false);
  });

  it("assigns a size set to a single product family or to a whole brand+gender", async () => {
    const fake = new FakeSizeSetsAdmin();
    const app = createCommerceApp({ repository: repository(), verifySession: verifier({ admin }), sizeSetsAdmin: fake });

    const sizeSetId = "11111111-1111-4111-8111-111111111111";
    const familyId = "22222222-2222-4222-8222-222222222222";
    const brandId = "33333333-3333-4333-8333-333333333333";

    const byFamily = await app.request("/api/admin/size-sets/assign", { method: "POST", headers: headers("admin"), body: JSON.stringify({ sizeSetId, familyId }) });
    expect(byFamily.status).toBe(200);
    await expect(byFamily.json()).resolves.toEqual({ colourwaysAffected: 42 });

    const byBrandGender = await app.request("/api/admin/size-sets/assign", { method: "POST", headers: headers("admin"), body: JSON.stringify({ sizeSetId, brandId, gender: "MENS" }) });
    expect(byBrandGender.status).toBe(200);
    expect(fake.assignCalls).toHaveLength(2);

    const invalid = await app.request("/api/admin/size-sets/assign", { method: "POST", headers: headers("admin"), body: JSON.stringify({ sizeSetId: "not-a-uuid" }) });
    expect(invalid.status).toBe(400);
  });
});
