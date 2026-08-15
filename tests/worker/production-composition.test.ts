import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createCommerceApp } from "../../worker/app";
import { createVerifiedSessionVerifier } from "../../worker/auth/verified-session";
import { SessionService } from "../../worker/auth/session";
import { SupabaseCommerceRepository } from "../../worker/supabase-commerce-repository";
import { dealerA, headers, repository, verifier } from "./fixtures";

function chain(result: unknown) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "not", "order", "limit", "in", "is"]) {
    query[method] = vi.fn(() => query);
  }
  query.maybeSingle = vi.fn(async () => result);
  query.single = vi.fn(async () => result);
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return query;
}

describe("production commerce composition", () => {
  it("revalidates the encrypted application session against current app_users/dealers state", async () => {
    const sessions = new SessionService("production-session-secret-that-is-long-enough");
    const token = await sessions.sealApplication({
      authUserId: "user-a",
      organisationId: "org-1",
      dealerId: "dealer-a",
      email: "owner@example.test",
    });
    const from = vi.fn((table: string) => {
      if (table === "app_users") return chain({ data: { auth_user_id: "user-a", organisation_id: "org-1", dealer_id: "dealer-a", app_role: "DEALER", status: "ACTIVE" }, error: null });
      if (table === "dealers") return chain({ data: { id: "dealer-a", organisation_id: "org-1", activation_status: "ACTIVE", pilot_email: "owner@example.test" }, error: null });
      throw new Error(`unexpected table ${table}`);
    });
    const client = { from } as unknown as SupabaseClient;

    const verify = createVerifiedSessionVerifier(client, sessions);
    const identity = await verify(new Request("https://kitco.test/api/catalogue", {
      headers: { cookie: `kitco_session=${token}` },
    }));

    expect(identity).toMatchObject({ userId: "user-a", organisationId: "org-1", dealerId: "dealer-a", role: "DEALER" });
  });

  it("revalidates a SUPERADMIN session without being rejected by the ADMIN-only branch", async () => {
    const sessions = new SessionService("production-session-secret-that-is-long-enough");
    const token = await sessions.sealApplication({
      authUserId: "user-super",
      organisationId: "org-1",
      dealerId: null,
      email: "superadmin@example.test",
    });
    const from = vi.fn((table: string) => {
      if (table === "app_users") return chain({ data: { auth_user_id: "user-super", organisation_id: "org-1", dealer_id: null, app_role: "SUPERADMIN", status: "ACTIVE" }, error: null });
      throw new Error(`unexpected table ${table}`);
    });
    const client = { from } as unknown as SupabaseClient;

    const verify = createVerifiedSessionVerifier(client, sessions);
    const identity = await verify(new Request("https://kitco.test/api/admin/orders", {
      headers: { cookie: `kitco_session=${token}` },
    }));

    expect(identity).toMatchObject({ userId: "user-super", organisationId: "org-1", dealerId: null, role: "SUPERADMIN" });
  });

  it("maps only published canonical catalogue rows and emits organisation-scoped media keys", async () => {
    const rows = [{
      id: "offer-1", organisation_id: "org-1", offering_type: "STOCK_IN_HAND", mrp_minor: 10000, currency_code: "INR", moq_pairs: 4,
      order_multiple: 2, opens_at: "2026-01-01T00:00:00Z", closes_at: "2026-12-31T23:59:59Z", published_at: "2026-08-13T00:00:00Z",
      product_colourways: {
        id: "cw-1", article_no: "NK-101", colour: "Black", published_at: "2026-08-13T00:00:00Z",
        product_families: { brands: { name: "Nike" } },
        product_size_values: [{ enabled: true, size_values: { label: "7", sort_order: 1 } }, { enabled: true, size_values: { label: "8", sort_order: 2 } }],
        product_media: [{ object_key: "media/nike/NK-101/600.webp", media_kind: "WEBP_600", published_at: "2026-08-13T00:00:00Z" }],
        stock_snapshot_lines: [{ quantity_pairs: 7 }],
      },
    }];
    const client = { from: vi.fn(() => chain({ data: rows, error: null })) } as unknown as SupabaseClient;
    const repo = new SupabaseCommerceRepository(client);

    await expect(repo.listCatalogue(dealerA)).resolves.toEqual([expect.objectContaining({
      organisationId: "org-1", articleNo: "NK-101", mrpMinor: 10000,
      mediaKey: "org-1/media/nike/NK-101/600.webp", stockPairs: 7,
      offering: expect.objectContaining({ enabledSizes: ["7", "8"], moqPairs: 4, orderMultiplePairs: 2, type: "STOCK_IN_HAND" }),
    })]);
  });

  it("normalises the full gender vocabulary and falls back to UNKNOWN instead of null", async () => {
    const familyFor = (gender: unknown) => ({ brands: { name: "Nike" }, category: "Running", gender });
    const rowFor = (id: string, gender: unknown) => ({
      id, organisation_id: "org-1", offering_type: "STOCK_IN_HAND", mrp_minor: 10000, currency_code: "INR", moq_pairs: 4,
      order_multiple: 2, opens_at: "2026-01-01T00:00:00Z", closes_at: "2026-12-31T23:59:59Z", published_at: "2026-08-13T00:00:00Z",
      product_colourways: {
        id: `cw-${id}`, article_no: id, colour: "Black", published_at: "2026-08-13T00:00:00Z",
        product_families: familyFor(gender),
        product_size_values: [], product_media: [], stock_snapshot_lines: [],
      },
    });
    const rows = [
      rowFor("mens", "Mens"), rowFor("womens", "WOMENS"), rowFor("unisex", "unisex"),
      rowFor("kids", "Kids"), rowFor("blank", ""), rowFor("typo", "Boys"),
    ];
    const client = { from: vi.fn(() => chain({ data: rows, error: null })) } as unknown as SupabaseClient;
    const repo = new SupabaseCommerceRepository(client);

    const catalogue = await repo.listCatalogue(dealerA);

    expect(catalogue.map((item) => item.gender)).toEqual(["MEN", "WOMEN", "UNISEX", "KIDS", "UNKNOWN", "UNKNOWN"]);
    expect(catalogue.every((item) => item.gender !== null)).toBe(true);
  });

  it("requires the real OTP verifier before handing an order to persistence", async () => {
    const repo = repository();
    const verifyOrderOtp = vi.fn(async () => undefined);
    const app = createCommerceApp({ repository: repo, verifySession: verifier({ a: dealerA }), verifyOrderOtp });
    await app.request("/api/drafts/current", {
      method: "PUT", headers: headers("a"), body: JSON.stringify({ offeringId: "offer-1", quantities: { "7": 4 } }),
    });
    const response = await app.request("/api/orders/submit", {
      method: "POST", headers: { ...headers("a"), "idempotency-key": "live-idem" },
      body: JSON.stringify({ otpChallengeId: "otp-order-a", otpCode: "482901" }),
    });

    expect(response.status).toBe(201);
    expect(verifyOrderOtp).toHaveBeenCalledWith(dealerA, "otp-order-a", "482901");
  });
});
