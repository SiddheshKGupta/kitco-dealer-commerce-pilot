import { Hono } from "hono";
import { CaptureEmailProvider, type EmailOTPProvider } from "../../worker/auth/email-provider";
import {
  InMemoryOtpChallengeStore,
  OtpService,
  type OtpPurpose,
} from "../../worker/auth/otp-service";
import { SessionService } from "../../worker/auth/session";
import { registerActivationRoutes, type ActivationStore, type DealerRecord } from "../../worker/routes/activation";
import { registerLoginRoutes, type PasswordAuthenticator } from "../../worker/routes/login";
import { registerOtpRoutes } from "../../worker/routes/otp";

const NOW = new Date("2026-08-13T12:00:00.000Z");

class MemoryActivationStore implements ActivationStore {
  dealers: DealerRecord[] = [
    {
      id: "dealer-1",
      organisationId: "org-1",
      name: "National Sports",
      city: "Patna",
      masterEmail: "owner@dealer.test",
      pilotEmail: null,
      activationStatus: "UNACTIVATED",
      authUserId: null,
    },
  ];

  async search(query: string) {
    return this.dealers.filter((dealer) => dealer.name.toLowerCase().includes(query.toLowerCase()));
  }

  async get(id: string) {
    return this.dealers.find((dealer) => dealer.id === id) ?? null;
  }

  async begin(id: string, pilotEmail: string) {
    const dealer = await this.get(id);
    if (!dealer || dealer.authUserId || dealer.activationStatus === "ACTIVE") return false;
    dealer.pilotEmail = pilotEmail;
    dealer.activationStatus = "EMAIL_OTP_PENDING";
    return true;
  }

  async activate(id: string, authUserId: string) {
    const dealer = await this.get(id);
    if (!dealer || dealer.authUserId || dealer.activationStatus === "ACTIVE") return false;
    dealer.authUserId = authUserId;
    dealer.activationStatus = "ACTIVE";
    return true;
  }

  async release(id: string) {
    const dealer = await this.get(id);
    if (!dealer || dealer.activationStatus !== "EMAIL_OTP_PENDING" || dealer.authUserId) return;
    dealer.activationStatus = "UNACTIVATED";
    dealer.pilotEmail = null;
  }
}

class MemoryAuthenticator implements PasswordAuthenticator {
  released = 0;
  created = 0;
  createdEmail = "";
  createdPassword = "";

  async authenticate(email: string, password: string) {
    if (email === this.createdEmail && password === this.createdPassword) {
      return { authUserId: "user-created", dealerId: "dealer-1", organisationId: "org-1", email, accessToken: "new-supabase-access" };
    }
    if (email !== "owner@dealer.test" || password !== "correct horse") return null;
    return { authUserId: "user-1", dealerId: "dealer-1", organisationId: "org-1", email, accessToken: "supabase-access" };
  }

  async createUser(email: string, password: string) {
    this.created += 1;
    this.createdEmail = email;
    this.createdPassword = password;
    return { authUserId: "user-created", email, password };
  }

  noteReleased() {
    this.released += 1;
  }
}

function buildHarness() {
  const store = new MemoryActivationStore();
  const challengeStore = new InMemoryOtpChallengeStore();
  const provider = new CaptureEmailProvider();
  const authenticator = new MemoryAuthenticator();
  const sessions = new SessionService("test-secret-at-least-32-characters-long", () => NOW);
  const otp = new OtpService(challengeStore, provider, {
    now: () => NOW,
    code: () => "482901",
    pepper: "test-otp-pepper-at-least-32-characters",
  });
  const app = new Hono();
  registerActivationRoutes(app, { store, otp, sessions, authenticator, activationAccessCode: "pilot-invite-2026" });
  registerLoginRoutes(app, { authenticator, otp, sessions });
  registerOtpRoutes(app, { otp, sessions, authenticator, activationStore: store });
  return { app, store, challengeStore, provider, authenticator, sessions, otp };
}

describe("Worker activation and authentication", () => {
  it("rejects activation without the independent pilot access code before claiming a dealer", async () => {
    const { app, store, provider } = buildHarness();
    const response = await app.request("/api/activation/request-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dealerId: "dealer-1", email: "pilot@dealer.test", accessCode: "wrong-code" }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "ACTIVATION_NOT_AUTHORISED" });
    expect(store.dealers[0]).toMatchObject({ activationStatus: "UNACTIVATED", pilotEmail: null });
    expect(provider.deliveries).toHaveLength(0);
  });

  it("requires a useful lookup prefix and returns only public autocomplete fields", async () => {
    const { app } = buildHarness();
    expect((await app.request("/api/activation/dealers?q=n")).status).toBe(400);

    const response = await app.request("/api/activation/dealers?q=nat");
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ dealers: [{ id: "dealer-1", name: "National Sports", city: "Patna" }] });
    expect(body).not.toContain("owner@dealer.test");
  });

  it("preserves master email and prevents a second activation claim", async () => {
    const { app, store, provider } = buildHarness();
    const first = await app.request("/api/activation/request-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dealerId: "dealer-1", email: "pilot@dealer.test", accessCode: "pilot-invite-2026" }),
    });
    expect(first.status).toBe(202);
    expect(store.dealers[0]?.masterEmail).toBe("owner@dealer.test");
    expect(provider.deliveries[0]).toMatchObject({ to: "pilot@dealer.test", purpose: "ACTIVATION" });

    store.dealers[0]!.activationStatus = "ACTIVE";
    store.dealers[0]!.authUserId = "existing-user";
    const second = await app.request("/api/activation/request-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dealerId: "dealer-1", email: "another@dealer.test", accessCode: "pilot-invite-2026" }),
    });
    expect(second.status).toBe(409);
    expect(store.dealers[0]?.pilotEmail).toBe("pilot@dealer.test");
  });

  it("selects the master email server-side without exposing it in lookup data", async () => {
    const { app, provider, store } = buildHarness();
    const response = await app.request("/api/activation/request-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dealerId: "dealer-1", emailChoice: "MASTER", accessCode: "pilot-invite-2026" }),
    });
    expect(response.status).toBe(202);
    expect(provider.deliveries[0]?.to).toBe("owner@dealer.test");
    expect(store.dealers[0]?.masterEmail).toBe("owner@dealer.test");
  });

  it("releases an activation claim after provider failure without changing master email", async () => {
    const store = new MemoryActivationStore();
    const failingProvider: EmailOTPProvider = { sendOtp: async () => { throw new Error("provider unavailable"); } };
    const otp = new OtpService(new InMemoryOtpChallengeStore(), failingProvider, {
      now: () => NOW,
      code: () => "482901",
      pepper: "test-otp-pepper-at-least-32-characters",
    });
    const app = new Hono();
    registerActivationRoutes(app, {
      store,
      otp,
      sessions: new SessionService("test-secret-at-least-32-characters-long", () => NOW),
      authenticator: new MemoryAuthenticator(),
      activationAccessCode: "pilot-invite-2026",
    });

    const response = await app.request("/api/activation/request-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dealerId: "dealer-1", email: "pilot@dealer.test", accessCode: "pilot-invite-2026" }),
    });
    expect(response.status).toBe(502);
    expect(store.dealers[0]).toMatchObject({
      activationStatus: "UNACTIVATED",
      pilotEmail: null,
      masterEmail: "owner@dealer.test",
    });
  });

  it("stores a keyed hash instead of the OTP and enforces cooldown", async () => {
    const { otp, challengeStore, provider } = buildHarness();
    const issued = await otp.issue({ organisationId: "org-1", dealerId: "dealer-1", to: "owner@dealer.test", purpose: "LOGIN" });
    expect(challengeStore.challenges[0]?.codeHash).not.toContain("482901");
    expect(challengeStore.challenges[0]?.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(provider.deliveries).toHaveLength(1);
    await expect(otp.resend(issued.id)).rejects.toThrow("OTP_RESEND_COOLDOWN");
  });

  it.each<[OtpPurpose, OtpPurpose]>([
    ["ACTIVATION", "LOGIN"],
    ["LOGIN", "ORDER_SUBMISSION"],
    ["ORDER_SUBMISSION", "REVISION_ACCEPTANCE"],
  ])("rejects %s OTP for %s", async (issuedPurpose, verifiedPurpose) => {
    const { otp } = buildHarness();
    const challenge = await otp.issue({ organisationId: "org-1", dealerId: "dealer-1", to: "owner@dealer.test", purpose: issuedPurpose });
    await expect(otp.verify(challenge.id, "482901", verifiedPurpose)).rejects.toThrow("OTP_PURPOSE_MISMATCH");
  });

  it("enforces expiry, attempt limits, single-use consumption and replay rejection", async () => {
    let now = NOW;
    const challengeStore = new InMemoryOtpChallengeStore();
    const provider = new CaptureEmailProvider();
    const otp = new OtpService(challengeStore, provider, {
      now: () => now,
      code: () => "482901",
      pepper: "test-otp-pepper-at-least-32-characters",
      maxAttempts: 2,
    });
    const expired = await otp.issue({ organisationId: "org-1", dealerId: "dealer-1", to: "owner@dealer.test", purpose: "LOGIN" });
    now = new Date(NOW.getTime() + 10 * 60_000);
    await expect(otp.verify(expired.id, "482901", "LOGIN")).rejects.toThrow("OTP_EXPIRED");

    now = NOW;
    const limited = await otp.issue({ organisationId: "org-1", dealerId: "dealer-1", to: "owner@dealer.test", purpose: "LOGIN" });
    await expect(otp.verify(limited.id, "000000", "LOGIN")).rejects.toThrow("OTP_INVALID");
    await expect(otp.verify(limited.id, "000000", "LOGIN")).rejects.toThrow("OTP_INVALID");
    await expect(otp.verify(limited.id, "482901", "LOGIN")).rejects.toThrow("OTP_ATTEMPTS_EXHAUSTED");

    const singleUse = await otp.issue({ organisationId: "org-1", dealerId: "dealer-1", to: "owner@dealer.test", purpose: "LOGIN" });
    await expect(otp.verify(singleUse.id, "482901", "LOGIN")).resolves.toBeDefined();
    await expect(otp.verify(singleUse.id, "482901", "LOGIN")).rejects.toThrow("OTP_ALREADY_CONSUMED");
  });

  it("does not release a Supabase result or application cookie before login OTP succeeds", async () => {
    const { app, provider, authenticator } = buildHarness();
    const password = await app.request("/api/login/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "owner@dealer.test", password: "correct horse" }),
    });
    expect(password.status).toBe(202);
    const passwordBody = await password.text();
    expect(JSON.parse(passwordBody)).toMatchObject({ otpRequired: true });
    expect(password.headers.get("set-cookie")).toContain("kitco_pending=");
    expect(password.headers.get("set-cookie")).not.toContain("kitco_session=");
    expect(passwordBody).not.toContain("supabase-access");
    expect(authenticator.released).toBe(0);

    const pendingCookie = password.headers.get("set-cookie")!.split(";")[0]!;
    const verified = await app.request("/api/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: pendingCookie },
      body: JSON.stringify({ challengeId: provider.deliveries[0]!.challengeId, code: "482901", purpose: "LOGIN" }),
    });
    expect(verified.status).toBe(200);
    const cookie = verified.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("kitco_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(authenticator.released).toBe(1);
  });

  it("exposes resend only through the pending session and enforces cooldown", async () => {
    const { app, provider } = buildHarness();
    const password = await app.request("/api/login/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "owner@dealer.test", password: "correct horse" }),
    });
    const pendingCookie = password.headers.get("set-cookie")!.split(";")[0]!;
    const response = await app.request("/api/otp/resend", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: pendingCookie },
      body: JSON.stringify({ challengeId: provider.deliveries[0]!.challengeId }),
    });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "OTP_RESEND_COOLDOWN" });
    expect(provider.deliveries).toHaveLength(1);
  });

  it("does not consume an activation OTP before password validation succeeds", async () => {
    const { app, provider, store, authenticator, sessions } = buildHarness();
    const requested = await app.request("/api/activation/request-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dealerId: "dealer-1", email: "pilot@dealer.test", accessCode: "pilot-invite-2026" }),
    });
    const pendingCookie = requested.headers.get("set-cookie")!.split(";")[0]!;
    const verify = (password: string) => app.request("/api/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: pendingCookie },
      body: JSON.stringify({
        challengeId: provider.deliveries[0]!.challengeId,
        code: "482901",
        purpose: "ACTIVATION",
        password,
      }),
    });

    expect((await verify("short")).status).toBe(400);
    const completed = await verify("a strong pilot password");
    expect(completed.status).toBe(200);
    expect(store.dealers[0]?.masterEmail).toBe("owner@dealer.test");
    expect(store.dealers[0]?.authUserId).toBe("user-created");
    expect(authenticator.created).toBe(1);
    const applicationCookie = completed.headers.get("set-cookie")?.match(/kitco_session=([^;]+)/u)?.[1];
    expect(applicationCookie).toBeTruthy();
    await expect(sessions.openApplication(applicationCookie!)).resolves.toMatchObject({ accessToken: "new-supabase-access" });
  });
});
