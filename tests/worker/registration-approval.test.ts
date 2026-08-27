import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { CaptureEmailProvider } from "../../worker/auth/email-provider";
import { InMemoryOtpChallengeStore, OtpService } from "../../worker/auth/otp-service";
import { SessionService } from "../../worker/auth/session";
import type { LoginIdentityResolver } from "../../worker/routes/login";
import { registerOtpRoutes } from "../../worker/routes/otp";
import {
  registerRegistrationRoutes,
  type DealerApplicationInput,
  type DealerApplicationRecord,
  type DealerApplicationStore,
} from "../../worker/routes/register";

const NOW = new Date("2026-08-25T12:00:00.000Z");

const APPLICATION: DealerApplicationInput = {
  businessName: "Bihar Sports House",
  gstin: "10ABCDE1234F1Z5",
  addressLine1: "12 Station Road",
  city: "Patna",
  state: "Bihar",
  pinCode: "800001",
  contactPerson: "Asha Rao",
  primaryEmail: "owner@biharsports.test",
  mobile: "9800000000",
};

class MemoryApplicationStore implements DealerApplicationStore {
  readonly applications = new Map<string, DealerApplicationRecord>();
  private next = 1;

  async create(input: DealerApplicationInput) {
    const id = `app-${this.next++}`;
    this.applications.set(id, { id, organisationId: "org-1", primaryEmail: input.primaryEmail, status: "DRAFT" });
    return { id, organisationId: "org-1" };
  }

  async get(applicationId: string) {
    return this.applications.get(applicationId) ?? null;
  }

  async submit(applicationId: string) {
    const application = this.applications.get(applicationId);
    if (!application || application.status !== "DRAFT") return false;
    application.status = "SUBMITTED";
    return true;
  }
}

/** Every method records the call, so a test can prove the registration branch never
 *  reaches for an identity at all. v5 removed createUser() outright -- there is no
 *  longer any code path that mints an auth user outside admin credential issuance --
 *  so the guard is now "the resolver was not touched", which is strictly stronger. */
class CountingIdentityResolver implements LoginIdentityResolver {
  readonly calls: string[] = [];
  async resolve() { this.calls.push("resolve"); return null; }
  async byAuthUserId() { this.calls.push("byAuthUserId"); return null; }
  async verifyPassword() { this.calls.push("verifyPassword"); return false; }
  async setPassword() { this.calls.push("setPassword"); }
  async moveAccountState() { this.calls.push("moveAccountState"); }
  async stampLogin() { this.calls.push("stampLogin"); }
}

function buildHarness() {
  const store = new MemoryApplicationStore();
  const identity = new CountingIdentityResolver();
  const provider = new CaptureEmailProvider();
  const sessions = new SessionService("test-secret-at-least-32-characters-long", () => NOW);
  const otp = new OtpService(new InMemoryOtpChallengeStore(), provider, {
    now: () => NOW,
    code: () => "482901",
    pepper: "test-otp-pepper-at-least-32-characters",
  });
  const app = new Hono();
  registerRegistrationRoutes(app, { store, otp, sessions });
  registerOtpRoutes(app, { otp, sessions, identity, applicationStore: store });
  return { app, store, identity, provider };
}

/** Walks a prospective dealer through the public form to the code prompt. */
async function applyAndRequestCode(app: Hono) {
  const created = await app.request("/api/register", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(APPLICATION),
  });
  const { applicationId } = await created.json() as { applicationId: string };
  const issued = await app.request(`/api/register/${applicationId}/otp`, { method: "POST", body: "{}" });
  const cookie = issued.headers.get("set-cookie")!.split(";")[0]!;
  const { challengeId } = await issued.json() as { challengeId: string };
  return { applicationId, cookie, challengeId };
}

describe("new dealer registration", () => {
  it("submits the application for review and signs nobody in", async () => {
    // This is the regression guard for a real hole: verification used to call
    // approveAndActivate(), which created an ACTIVE dealer and a DEALER session.
    // Anyone on the internet could register a shop, verify their own address and
    // browse wholesale pricing. Verifying an emailed code proves the applicant
    // owns that mailbox -- nothing about whether KITCO wants them as a dealer.
    const { app, store, identity } = buildHarness();
    const { applicationId, cookie, challengeId } = await applyAndRequestCode(app);

    const response = await app.request("/api/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ challengeId, code: "482901", purpose: "REGISTRATION" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: false, submitted: true });
    expect(store.applications.get(applicationId)?.status).toBe("SUBMITTED");
    // No account was created and no session cookie was handed out.
    expect(identity.calls).toEqual([]);
    const cookies = response.headers.getSetCookie().join(" ");
    expect(cookies).not.toContain("kitco_session");
    expect(cookies).toContain("kitco_pending=;");
  });

  it("refuses a second verification of the same application", async () => {
    const { app } = buildHarness();
    const { cookie, challengeId } = await applyAndRequestCode(app);
    const verify = () => app.request("/api/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ challengeId, code: "482901", purpose: "REGISTRATION" }),
    });

    expect((await verify()).status).toBe(200);
    expect((await verify()).status).not.toBe(200);
  });

  it("will not issue a code for an application that is already with KITCO", async () => {
    const { app, store } = buildHarness();
    const { applicationId, cookie, challengeId } = await applyAndRequestCode(app);
    await app.request("/api/otp/verify", {
      method: "POST", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ challengeId, code: "482901", purpose: "REGISTRATION" }),
    });
    expect(store.applications.get(applicationId)?.status).toBe("SUBMITTED");

    const again = await app.request(`/api/register/${applicationId}/otp`, { method: "POST", body: "{}" });
    expect(again.status).toBe(409);
  });

  it("enforces the resend cooldown -- a second immediate code request is rejected before another email goes out", async () => {
    // This endpoint needs no anon-vs-real masking (unlike /api/login/reset): the
    // application already exists, named by applicationId in the URL, so a 429 here
    // reveals nothing an attacker didn't already know.
    const { app, provider } = buildHarness();
    const created = await app.request("/api/register", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(APPLICATION),
    });
    const { applicationId } = await created.json() as { applicationId: string };

    const first = await app.request(`/api/register/${applicationId}/otp`, { method: "POST", body: "{}" });
    expect(first.status).toBe(202);
    expect(provider.deliveries).toHaveLength(1);

    const second = await app.request(`/api/register/${applicationId}/otp`, { method: "POST", body: "{}" });
    expect(second.status).toBe(429);
    expect(provider.deliveries).toHaveLength(1);
  });
});

describe("POST /api/register validation", () => {
  it("accepts a structurally valid GSTIN", async () => {
    const { app, store } = buildHarness();
    const response = await app.request("/api/register", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(APPLICATION),
    });
    expect(response.status).toBe(201);
    expect(store.applications.size).toBe(1);
  });

  it("rejects a GSTIN that is 15 characters but the wrong structure -- the old check only counted length", async () => {
    const { app } = buildHarness();
    const response = await app.request("/api/register", {
      method: "POST", headers: { "content-type": "application/json" },
      // Digits where the 5-letter PAN block belongs.
      body: JSON.stringify({ ...APPLICATION, gstin: "22123450000A1Z5" }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects a mobile number that isn't a valid Indian mobile shape", async () => {
    const { app } = buildHarness();
    const response = await app.request("/api/register", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...APPLICATION, mobile: "1234567890" }), // starts with 1, not 6-9
    });
    expect(response.status).toBe(400);
  });

  it("rejects a PIN code that isn't 6 digits", async () => {
    const { app } = buildHarness();
    const response = await app.request("/api/register", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...APPLICATION, pinCode: "12345" }),
    });
    expect(response.status).toBe(400);
  });
});
