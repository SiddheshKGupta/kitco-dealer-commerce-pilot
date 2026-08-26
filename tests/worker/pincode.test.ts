import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { registerPincodeRoutes } from "../../worker/routes/pincode";

/** India Post's real shape: an array with one Status/PostOffice[] envelope. */
function indiaPostResponse(status: string, postOffice: Array<{ District?: string; State?: string }> | null) {
  return new Response(JSON.stringify([{ Message: "test", Status: status, PostOffice: postOffice }]), { status: 200 });
}

function appWith(fetchImpl: typeof fetch) {
  const app = new Hono();
  registerPincodeRoutes(app, fetchImpl);
  return app;
}

describe("GET /api/pincode/:code", () => {
  it("returns the city and state for a known PIN", async () => {
    const fetchImpl = (async () => indiaPostResponse("Success", [{ District: "Patna", State: "Bihar" }])) as typeof fetch;
    const response = await appWith(fetchImpl).request("/api/pincode/800001");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ found: true, city: "Patna", state: "Bihar" });
  });

  it("fails open -- reports not-found rather than an error -- for an unknown PIN", async () => {
    const fetchImpl = (async () => indiaPostResponse("Error", null)) as typeof fetch;
    const response = await appWith(fetchImpl).request("/api/pincode/000000");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ found: false });
  });

  it("fails open when the provider is unreachable, rather than blocking the form", async () => {
    const fetchImpl = (async () => { throw new Error("network down"); }) as typeof fetch;
    const response = await appWith(fetchImpl).request("/api/pincode/800001");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ found: false });
  });

  it("fails open when the provider returns a non-JSON or unexpected body", async () => {
    const fetchImpl = (async () => new Response("not json", { status: 200 })) as typeof fetch;
    const response = await appWith(fetchImpl).request("/api/pincode/800001");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ found: false });
  });

  it("fails open when the provider itself errors (non-2xx)", async () => {
    const fetchImpl = (async () => new Response("", { status: 500 })) as typeof fetch;
    const response = await appWith(fetchImpl).request("/api/pincode/800001");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ found: false });
  });

  it("rejects a code that isn't 6 digits, without calling the provider", async () => {
    const fetchImpl = (async () => { throw new Error("should not be called"); }) as typeof fetch;
    const response = await appWith(fetchImpl).request("/api/pincode/12345");

    expect(response.status).toBe(400);
  });
});
