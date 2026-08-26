import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { assertAccountTransition, type AccountState } from "../../worker/account-state";
import { CaptureEmailProvider, type EmailOTPProvider } from "../../worker/auth/email-provider";
import { InMemoryOtpChallengeStore, OtpService, type OtpPurpose } from "../../worker/auth/otp-service";
import { SessionService } from "../../worker/auth/session";
import { registerLoginRoutes, type LoginIdentity, type LoginIdentityResolver } from "../../worker/routes/login";
import { registerOtpRoutes } from "../../worker/routes/otp";

const NOW = new Date("2026-08-25T12:00:00.000Z");
const CODE = "482901";
const ISSUED_PASSWORD = "KITCO-ISSUED-1";
const NEW_PASSWORD = "my-own-password-9";

interface Account {
  code: string;
  identity: LoginIdentity;
  password: string;
}

/** Mirrors SupabaseLoginIdentityResolver's contract closely enough to exercise the
 *  routes: same identifier precedence (Dealer Code, then email), same state machine via
 *  the real assertAccountTransition, same "password lives in the auth store" split.
 *  These are route tests -- the SQL side of the same flow is tests/db. */
class MemoryIdentityResolver implements LoginIdentityResolver {
  readonly stamps: { first: boolean }[] = [];

  constructor(readonly accounts: Record<string, Account>) {}

  private all() { return Object.values(this.accounts); }

  async resolve(identifier: string) {
    const value = identifier.trim().toLowerCase();
    return this.all().find((account) => account.code.toLowerCase() === value || account.identity.email === value)?.identity ?? null;
  }

  async byAuthUserId(authUserId: string) {
    return this.all().find((account) => account.identity.authUserId === authUserId)?.identity ?? null;
  }

  async verifyPassword(identity: LoginIdentity, password: string) {
    const account = this.all().find((item) => item.identity.authUserId === identity.authUserId);
    return Boolean(account) && account!.password === password;
  }

  async setPassword(identity: LoginIdentity, password: string) {
    const account = this.all().find((item) => item.identity.authUserId === identity.authUserId)!;
    account.password = password;
    account.identity.mustChangePassword = false;
  }

  async moveAccountState(identity: LoginIdentity, to: AccountState) {
    identity.accountState = assertAccountTransition(identity.accountState, to);
  }

  async stampLogin(identity: LoginIdentity, first: boolean) {
    this.stamps.push({ first });
    if (first) identity.firstLoginAt = NOW.toISOString();
  }
}

function dealer(code: string, accountState: AccountState | null, overrides: Partial<LoginIdentity> = {}): Account {
  return {
    code,
    password: ISSUED_PASSWORD,
    identity: {
      authUserId: `user-${code}`,
      dealerId: `dealer-${code}`,
      organisationId: "org-1",
      email: `${code.toLowerCase()}@dealer.test`,
      role: "DEALER",
      accountState,
      mustChangePassword: accountState === "CREDENTIALS_ISSUED",
      firstLoginAt: null,
      ...overrides,
    },
  };
}

function buildHarness(accounts?: Record<string, Account>, provider: EmailOTPProvider = new CaptureEmailProvider()) {
  const identity = new MemoryIdentityResolver(accounts ?? {
    // Fresh from Phase 2 issuance: holds an admin-known password, has never signed in.
    kt001: dealer("KT001", "CREDENTIALS_ISSUED"),
    // Has completed a first login before.
    kt002: dealer("KT002", "ACTIVE", { mustChangePassword: false, firstLoginAt: "2026-08-01T00:00:00.000Z" }),
    kt003: dealer("KT003", "SUSPENDED", { mustChangePassword: false, firstLoginAt: "2026-08-01T00:00:00.000Z" }),
    // No email on file, so Phase 2 parked them here and never generated a password.
    kt004: dealer("KT004", "CREDENTIALS_PENDING", { mustChangePassword: false }),
  });
  const challengeStore = new InMemoryOtpChallengeStore();
  const sessions = new SessionService("test-secret-at-least-32-characters-long", () => NOW);
  const otp = new OtpService(challengeStore, provider, {
    now: () => NOW,
    code: () => CODE,
    pepper: "test-otp-pepper-at-least-32-characters",
  });
  const app = new Hono();
  registerLoginRoutes(app, { identity, otp, sessions });
  registerOtpRoutes(app, { otp, sessions, identity });
  return { app, identity, challengeStore, provider: provider as CaptureEmailProvider, sessions, otp };
}

function post(app: Hono, path: string, body: object, cookie?: string) {
  return app.request(path, {
    method: "POST",
    headers: cookie ? { "content-type": "application/json", cookie } : { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function cookieOf(response: Response, name: string): string {
  const match = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  return match ? match.split(";")[0]! : "";
}

describe("v5 sign-in: Dealer Code + password + OTP", () => {
  it("walks a first login through OTP to a forced password change and only then to ACTIVE", async () => {
    const { app, identity, provider } = buildHarness();
    const account = identity.accounts.kt001!;

    const started = await post(app, "/api/login", { identifier: "KT001", password: ISSUED_PASSWORD });
    expect(started.status).toBe(202);
    // The password alone earns a code, never a session.
    expect(cookieOf(started, "kitco_session")).toBe("");
    expect(account.identity.accountState).toBe("OTP_PENDING");
    expect(provider.deliveries[0]).toMatchObject({ to: "kt001@dealer.test", purpose: "LOGIN" });

    const pending = cookieOf(started, "kitco_pending");
    const verified = await post(app, "/api/otp/verify", { challengeId: provider.deliveries[0]!.challengeId, code: CODE, purpose: "LOGIN" }, pending);
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({ authenticated: true, role: "DEALER", mustChangePassword: true });
    expect(account.identity.accountState).toBe("PASSWORD_CHANGE_REQUIRED");
    // A first login is not a completed login: nothing is stamped until the issued
    // password has actually been replaced.
    expect(identity.stamps).toEqual([]);

    const session = cookieOf(verified, "kitco_session");
    const changed = await post(app, "/api/login/password", { password: NEW_PASSWORD }, session);
    expect(changed.status).toBe(200);
    expect(account.identity.accountState).toBe("ACTIVE");
    expect(account.identity.mustChangePassword).toBe(false);
    expect(account.password).toBe(NEW_PASSWORD);
    expect(identity.stamps).toEqual([{ first: true }]);
  });

  it("refuses to let the issued password be kept as the new one", async () => {
    const { app, identity, provider } = buildHarness();
    const started = await post(app, "/api/login", { identifier: "KT001", password: ISSUED_PASSWORD });
    const verified = await post(app, "/api/otp/verify",
      { challengeId: provider.deliveries[0]!.challengeId, code: CODE, purpose: "LOGIN" }, cookieOf(started, "kitco_pending"));

    const kept = await post(app, "/api/login/password", { password: ISSUED_PASSWORD }, cookieOf(verified, "kitco_session"));
    expect(kept.status).toBe(400);
    expect(await kept.json()).toEqual({ error: "PASSWORD_UNCHANGED" });
    expect(identity.accounts.kt001!.identity.accountState).toBe("PASSWORD_CHANGE_REQUIRED");

    const short = await post(app, "/api/login/password", { password: "short" }, cookieOf(verified, "kitco_session"));
    expect(short.status).toBe(400);
    expect(await short.json()).toEqual({ error: "PASSWORD_TOO_SHORT" });
  });

  it("does not move a returning dealer's state, and stamps the login once the code is verified", async () => {
    const { app, identity, provider } = buildHarness();
    const started = await post(app, "/api/login", { identifier: "kt002@dealer.test", password: ISSUED_PASSWORD });
    expect(started.status).toBe(202);
    // ACTIVE has no legal move to OTP_PENDING: repeat sign-in is not a provisioning
    // event, and treating it as one would throw on every login after the first.
    expect(identity.accounts.kt002!.identity.accountState).toBe("ACTIVE");

    const verified = await post(app, "/api/otp/verify",
      { challengeId: provider.deliveries[0]!.challengeId, code: CODE, purpose: "LOGIN" }, cookieOf(started, "kitco_pending"));
    expect(await verified.json()).toMatchObject({ authenticated: true, mustChangePassword: false });
    expect(identity.stamps).toEqual([{ first: false }]);
  });

  it("returns one indistinguishable answer for an unknown code, a wrong password, a suspended account and a dealer with no email", async () => {
    const { app, provider } = buildHarness();
    const attempts = await Promise.all([
      post(app, "/api/login", { identifier: "NOSUCH", password: ISSUED_PASSWORD }),
      post(app, "/api/login", { identifier: "KT001", password: "wrong-password" }),
      post(app, "/api/login", { identifier: "KT003", password: ISSUED_PASSWORD }),
      post(app, "/api/login", { identifier: "KT004", password: ISSUED_PASSWORD }),
    ]);
    for (const attempt of attempts) {
      expect(attempt.status).toBe(401);
      expect(await attempt.json()).toEqual({ error: "INVALID_CREDENTIALS" });
    }
    // Nothing was emailed to any of them, so a rejected sign-in cannot be used to make
    // KITCO send mail to an address an attacker chose.
    expect(provider.deliveries).toHaveLength(0);
  });

  it("frees a dealer stuck at OTP_PENDING by re-walking the first-login steps", async () => {
    const { app, identity } = buildHarness({ kt001: dealer("KT001", "OTP_PENDING") });
    const retried = await post(app, "/api/login", { identifier: "KT001", password: ISSUED_PASSWORD });
    expect(retried.status).toBe(202);
    expect(identity.accounts.kt001!.identity.accountState).toBe("OTP_PENDING");
  });
});

describe("v5 password recovery", () => {
  it("answers identically for a real account and one that does not exist", async () => {
    const { app, provider } = buildHarness();
    const real = await post(app, "/api/login/reset", { identifier: "KT002" });
    const fake = await post(app, "/api/login/reset", { identifier: "NOSUCH" });

    const realBody = await real.json() as Record<string, unknown>;
    const fakeBody = await fake.json() as Record<string, unknown>;
    expect(fake.status).toBe(real.status);
    expect(Object.keys(fakeBody)).toEqual(Object.keys(realBody));
    expect(fakeBody.otpRequired).toEqual(realBody.otpRequired);
    expect(String(fakeBody.challengeId)).toMatch(/^[0-9a-f-]{36}$/u);
    expect(cookieOf(fake, "kitco_pending").length > 0).toBe(true);
    // Only the real one produced a code, and the caller cannot tell.
    expect(provider.deliveries).toHaveLength(1);

    // Typing a code against the challenge id the decoy handed back fails with the same
    // message a real account gives for a wrong code -- not OTP_NOT_FOUND, which would
    // confirm the account does not exist.
    const decoy = await post(app, "/api/otp/verify",
      { challengeId: fakeBody.challengeId, code: CODE, purpose: "PASSWORD_RESET" }, cookieOf(fake, "kitco_pending"));
    expect(decoy.status).toBe(400);
    expect(await decoy.json()).toEqual({ error: "OTP_INVALID" });
  });

  it("resets to ACTIVE and never to PASSWORD_CHANGE_REQUIRED", async () => {
    const { app, identity, provider } = buildHarness();
    const started = await post(app, "/api/login/reset", { identifier: "KT002" });
    expect(provider.deliveries[0]).toMatchObject({ purpose: "PASSWORD_RESET" });

    const verified = await post(app, "/api/otp/verify",
      { challengeId: provider.deliveries[0]!.challengeId, code: CODE, purpose: "PASSWORD_RESET" }, cookieOf(started, "kitco_pending"));
    expect(verified.status).toBe(200);
    // Verifying a reset code signs nobody in on its own.
    expect(await verified.json()).toEqual({ authenticated: false, passwordResetAuthorised: true });
    expect(cookieOf(verified, "kitco_session")).toBe("");

    const changed = await post(app, "/api/login/password", { password: NEW_PASSWORD }, cookieOf(verified, "kitco_pending"));
    expect(changed.status).toBe(200);
    expect(identity.accounts.kt002!.identity.accountState).toBe("ACTIVE");
    expect(identity.accounts.kt002!.password).toBe(NEW_PASSWORD);
  });

  it("sends no code to a dealer who has never completed a first login", async () => {
    // Their password is admin-known and their recovery is admin re-issuance. Allowing
    // a reset here would let anyone with the mailbox skip the issued-password factor.
    const { app, provider } = buildHarness();
    const response = await post(app, "/api/login/reset", { identifier: "KT001" });
    expect(response.status).toBe(202);
    expect(provider.deliveries).toHaveLength(0);
  });

  it("will not let an unverified reset set a password", async () => {
    const { app, identity } = buildHarness();
    const started = await post(app, "/api/login/reset", { identifier: "KT002" });
    const response = await post(app, "/api/login/password", { password: NEW_PASSWORD }, cookieOf(started, "kitco_pending"));
    expect(response.status).toBe(401);
    expect(identity.accounts.kt002!.password).toBe(ISSUED_PASSWORD);
  });
});

describe("OTP service after PILOT_STATIC_OTP removal", () => {
  it("rejects 123456 against a production-configured service", async () => {
    // V5_AUTH_FLOW.md §7: there is no options field, no env var and no branch that can
    // switch this back on -- the bypass is absent, not disabled.
    const provider = new CaptureEmailProvider();
    const otp = new OtpService(new InMemoryOtpChallengeStore(), provider, { pepper: "production-pepper-at-least-32-characters" });
    const challenge = await otp.issue({ organisationId: "org-1", dealerId: "dealer-1", to: "owner@dealer.test", purpose: "LOGIN" });
    await expect(otp.verify(challenge.id, "123456", "LOGIN")).rejects.toThrow(/OTP_INVALID|OTP_ATTEMPTS_EXHAUSTED/u);
  });

  it("consumes a challenge whose code could not be delivered instead of leaving it live", async () => {
    const store = new InMemoryOtpChallengeStore();
    const failing: EmailOTPProvider = { sendOtp: async () => { throw new Error("provider unavailable"); } };
    const otp = new OtpService(store, failing, { now: () => NOW, code: () => CODE, pepper: "test-otp-pepper-at-least-32-characters" });
    await expect(otp.issue({ organisationId: "org-1", dealerId: "dealer-1", to: "owner@dealer.test", purpose: "LOGIN" }))
      .rejects.toThrow("EMAIL_DELIVERY_FAILED");
    expect(store.challenges[0]?.consumedAt).not.toBeNull();
  });

  it("stores a keyed hash instead of the code and enforces the resend cooldown", async () => {
    const { otp, challengeStore, provider } = buildHarness();
    const issued = await otp.issue({ organisationId: "org-1", dealerId: "dealer-1", to: "owner@dealer.test", purpose: "LOGIN" });
    expect(challengeStore.challenges[0]?.codeHash).not.toContain(CODE);
    expect(challengeStore.challenges[0]?.codeHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(provider.deliveries).toHaveLength(1);
    await expect(otp.resend(issued.id)).rejects.toThrow("OTP_RESEND_COOLDOWN");
  });

  it.each<[OtpPurpose, OtpPurpose]>([
    ["LOGIN", "PASSWORD_RESET"],
    ["PASSWORD_RESET", "LOGIN"],
    ["LOGIN", "ORDER_SUBMISSION"],
    ["ORDER_SUBMISSION", "REVISION_ACCEPTANCE"],
  ])("rejects a %s code spent as %s", async (issuedPurpose, verifiedPurpose) => {
    const { otp } = buildHarness();
    const challenge = await otp.issue({ organisationId: "org-1", dealerId: "dealer-1", to: "owner@dealer.test", purpose: issuedPurpose });
    await expect(otp.verify(challenge.id, CODE, verifiedPurpose)).rejects.toThrow("OTP_PURPOSE_MISMATCH");
  });

  it("enforces expiry, attempt limits, single-use consumption and replay rejection", async () => {
    let now = NOW;
    const otp = new OtpService(new InMemoryOtpChallengeStore(), new CaptureEmailProvider(), {
      now: () => now, code: () => CODE, pepper: "test-otp-pepper-at-least-32-characters", maxAttempts: 2,
    });
    const expired = await otp.issue({ organisationId: "org-1", dealerId: "dealer-1", to: "owner@dealer.test", purpose: "LOGIN" });
    now = new Date(NOW.getTime() + 10 * 60_000);
    await expect(otp.verify(expired.id, CODE, "LOGIN")).rejects.toThrow("OTP_EXPIRED");

    now = NOW;
    const limited = await otp.issue({ organisationId: "org-1", dealerId: "dealer-1", to: "owner@dealer.test", purpose: "LOGIN" });
    await expect(otp.verify(limited.id, "000000", "LOGIN")).rejects.toThrow("OTP_INVALID");
    await expect(otp.verify(limited.id, "000000", "LOGIN")).rejects.toThrow("OTP_INVALID");
    await expect(otp.verify(limited.id, CODE, "LOGIN")).rejects.toThrow("OTP_ATTEMPTS_EXHAUSTED");

    const singleUse = await otp.issue({ organisationId: "org-1", dealerId: "dealer-1", to: "owner@dealer.test", purpose: "LOGIN" });
    await expect(otp.verify(singleUse.id, CODE, "LOGIN")).resolves.toBeDefined();
    await expect(otp.verify(singleUse.id, CODE, "LOGIN")).rejects.toThrow("OTP_ALREADY_CONSUMED");
  });

  it("exposes resend only through the pending session", async () => {
    const { app, provider } = buildHarness();
    const started = await post(app, "/api/login", { identifier: "KT002", password: ISSUED_PASSWORD });
    const challengeId = provider.deliveries[0]!.challengeId;

    const unauthenticated = await post(app, "/api/otp/resend", { challengeId });
    expect(unauthenticated.status).toBe(401);

    const cooldown = await post(app, "/api/otp/resend", { challengeId }, cookieOf(started, "kitco_pending"));
    expect(cooldown.status).toBe(429);
    expect(provider.deliveries).toHaveLength(1);
  });
});
