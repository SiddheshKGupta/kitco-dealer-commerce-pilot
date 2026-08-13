import type { EmailOTPProvider, EmailOtpPurpose } from "./email-provider";

export type OtpPurpose = EmailOtpPurpose;

export interface StoredOtpChallenge {
  id: string;
  organisationId: string;
  dealerId: string;
  authUserId: string | null;
  purpose: OtpPurpose;
  codeHash: string;
  expiresAt: string;
  attempts: number;
  maxAttempts: number;
  consumedAt: string | null;
  correlationId: string;
  providerDeliveryId: string | null;
  createdAt: string;
}

export interface OtpChallengeStore {
  create(challenge: StoredOtpChallenge): Promise<void>;
  get(id: string): Promise<StoredOtpChallenge | null>;
  findLatest(organisationId: string, dealerId: string, purpose: OtpPurpose): Promise<StoredOtpChallenge | null>;
  update(challenge: StoredOtpChallenge, expectedAttempts?: number): Promise<boolean>;
}

export class InMemoryOtpChallengeStore implements OtpChallengeStore {
  readonly challenges: StoredOtpChallenge[] = [];

  async create(challenge: StoredOtpChallenge) {
    this.challenges.push({ ...challenge });
  }

  async get(id: string) {
    const challenge = this.challenges.find((item) => item.id === id);
    return challenge ? { ...challenge } : null;
  }

  async findLatest(organisationId: string, dealerId: string, purpose: OtpPurpose) {
    const challenge = this.challenges
      .filter((item) => item.organisationId === organisationId && item.dealerId === dealerId && item.purpose === purpose)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
    return challenge ? { ...challenge } : null;
  }

  async update(challenge: StoredOtpChallenge, expectedAttempts?: number) {
    const index = this.challenges.findIndex((item) => item.id === challenge.id);
    if (index < 0) throw new Error("OTP_NOT_FOUND");
    const current = this.challenges[index]!;
    if (expectedAttempts !== undefined && (current.consumedAt !== null || current.attempts !== expectedAttempts)) return false;
    this.challenges[index] = { ...challenge };
    return true;
  }
}

export interface IssueOtpInput {
  organisationId: string;
  dealerId: string;
  authUserId?: string | null;
  to: string;
  purpose: OtpPurpose;
  correlationId?: string;
  enforceCooldown?: boolean;
}

interface OtpOptions {
  now?: () => Date;
  code?: () => string;
  id?: () => string;
  pepper: string;
  ttlMs?: number;
  maxAttempts?: number;
  resendCooldownMs?: number;
}

const encoder = new TextEncoder();

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function keyedHash(value: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function equalHash(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function randomCode(): string {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String((values[0]! % 900_000) + 100_000);
}

export class OtpService {
  private readonly now: () => Date;
  private readonly code: () => string;
  private readonly id: () => string;
  private readonly ttlMs: number;
  private readonly maxAttempts: number;
  private readonly resendCooldownMs: number;

  constructor(
    private readonly store: OtpChallengeStore,
    private readonly provider: EmailOTPProvider,
    private readonly options: OtpOptions,
  ) {
    if (options.pepper.length < 32) throw new Error("OTP_PEPPER must be at least 32 characters");
    this.now = options.now ?? (() => new Date());
    this.code = options.code ?? randomCode;
    this.id = options.id ?? (() => crypto.randomUUID());
    this.ttlMs = options.ttlMs ?? 5 * 60_000;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.resendCooldownMs = options.resendCooldownMs ?? 60_000;
  }

  async issue(input: IssueOtpInput): Promise<StoredOtpChallenge> {
    const now = this.now();
    if (input.enforceCooldown) {
      const latest = await this.store.findLatest(input.organisationId, input.dealerId, input.purpose);
      if (latest && now.getTime() - Date.parse(latest.createdAt) < this.resendCooldownMs) {
        throw new Error("OTP_RESEND_COOLDOWN");
      }
    }
    const id = this.id();
    const code = this.code();
    if (!/^\d{6}$/.test(code)) throw new Error("OTP_GENERATION_FAILED");
    const correlationId = input.correlationId ?? this.id();
    const challenge: StoredOtpChallenge = {
      id,
      organisationId: input.organisationId,
      dealerId: input.dealerId,
      authUserId: input.authUserId ?? null,
      purpose: input.purpose,
      codeHash: await keyedHash(`${id}:${code}`, this.options.pepper),
      expiresAt: new Date(now.getTime() + this.ttlMs).toISOString(),
      attempts: 0,
      maxAttempts: this.maxAttempts,
      consumedAt: null,
      correlationId,
      providerDeliveryId: null,
      createdAt: now.toISOString(),
    };
    await this.store.create(challenge);
    try {
      const delivery = await this.provider.sendOtp({
        to: input.to,
        purpose: input.purpose,
        code,
        correlationId,
        challengeId: id,
      });
      challenge.providerDeliveryId = delivery.deliveryId;
      await this.store.update(challenge);
      return challenge;
    } catch {
      challenge.consumedAt = now.toISOString();
      await this.store.update(challenge);
      throw new Error("EMAIL_DELIVERY_FAILED");
    }
  }

  async resend(challengeId: string, to?: string): Promise<StoredOtpChallenge> {
    const previous = await this.store.get(challengeId);
    if (!previous) throw new Error("OTP_NOT_FOUND");
    if (this.now().getTime() - Date.parse(previous.createdAt) < this.resendCooldownMs) throw new Error("OTP_RESEND_COOLDOWN");
    if (!to) throw new Error("OTP_RECIPIENT_REQUIRED");
    previous.consumedAt = this.now().toISOString();
    await this.store.update(previous);
    return this.issue({
      organisationId: previous.organisationId,
      dealerId: previous.dealerId,
      authUserId: previous.authUserId,
      purpose: previous.purpose,
      to,
      correlationId: previous.correlationId,
    });
  }

  async verify(challengeId: string, code: string, purpose: OtpPurpose): Promise<StoredOtpChallenge> {
    const challenge = await this.store.get(challengeId);
    if (!challenge) throw new Error("OTP_NOT_FOUND");
    if (challenge.consumedAt) throw new Error("OTP_ALREADY_CONSUMED");
    if (challenge.purpose !== purpose) throw new Error("OTP_PURPOSE_MISMATCH");
    if (this.now().getTime() >= Date.parse(challenge.expiresAt)) throw new Error("OTP_EXPIRED");
    if (challenge.attempts >= challenge.maxAttempts) throw new Error("OTP_ATTEMPTS_EXHAUSTED");
    const supplied = await keyedHash(`${challenge.id}:${code}`, this.options.pepper);
    if (!equalHash(supplied, challenge.codeHash)) {
      const expectedAttempts = challenge.attempts;
      challenge.attempts += 1;
      if (!(await this.store.update(challenge, expectedAttempts))) throw new Error("OTP_ALREADY_CONSUMED");
      throw new Error("OTP_INVALID");
    }
    const expectedAttempts = challenge.attempts;
    challenge.consumedAt = this.now().toISOString();
    if (!(await this.store.update(challenge, expectedAttempts))) throw new Error("OTP_ALREADY_CONSUMED");
    return challenge;
  }
}
