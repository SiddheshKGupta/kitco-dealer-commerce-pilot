import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  isAdminRole,
  requireAdmin,
  requireSession,
  requireSuperAdmin,
  type AppRole,
  type AuthVariables,
} from "../../worker/middleware/auth";
import { handleApiError } from "../../worker/middleware/errors";

function appWithSession(role: AppRole) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.onError(handleApiError);
  app.use(
    "*",
    requireSession(async () => ({ userId: "u-1", organisationId: "org-1", dealerId: role === "DEALER" ? "dealer-1" : null, role })),
  );
  return app;
}

describe("isAdminRole", () => {
  it("treats ADMIN and SUPERADMIN as admin, DEALER as not", () => {
    expect(isAdminRole("ADMIN")).toBe(true);
    expect(isAdminRole("SUPERADMIN")).toBe(true);
    expect(isAdminRole("DEALER")).toBe(false);
  });
});

describe("requireAdmin", () => {
  it.each(["ADMIN", "SUPERADMIN"] as const)("allows %s through", async (role) => {
    const app = appWithSession(role);
    app.get("/api/admin/orders", requireAdmin(), (context) => context.json({ ok: true }));
    const response = await app.request("/api/admin/orders");
    expect(response.status).toBe(200);
  });

  it("rejects DEALER with 403", async () => {
    const app = appWithSession("DEALER");
    app.get("/api/admin/orders", requireAdmin(), (context) => context.json({ ok: true }));
    const response = await app.request("/api/admin/orders");
    expect(response.status).toBe(403);
  });
});

describe("requireSuperAdmin", () => {
  it("allows SUPERADMIN through", async () => {
    const app = appWithSession("SUPERADMIN");
    app.get("/api/admin/users", requireSuperAdmin(), (context) => context.json({ ok: true }));
    const response = await app.request("/api/admin/users");
    expect(response.status).toBe(200);
  });

  it("rejects a plain ADMIN with 403", async () => {
    const app = appWithSession("ADMIN");
    app.get("/api/admin/users", requireSuperAdmin(), (context) => context.json({ ok: true }));
    const response = await app.request("/api/admin/users");
    expect(response.status).toBe(403);
  });
});
