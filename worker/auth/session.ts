/** A password recovery in flight. `authUserId` is null when the identifier matched
 *  nothing — the decoy that keeps the recovery form from confirming who is a KITCO
 *  dealer (V5_AUTH_FLOW.md §4). `verified` flips only once the code is accepted, and
 *  it is what authorises exactly one call to /api/login/password. */
export interface PendingResetSession {
  kind: "reset";
  challengeId: string;
  authUserId: string | null;
  verified: boolean;
}

export interface PendingRegistrationSession {
  kind: "registration";
  challengeId: string;
  applicationId: string;
  organisationId: string;
  email: string;
}

export type PendingSession = PendingResetSession | PendingRegistrationSession;

export interface ApplicationSession {
  authUserId: string;
  dealerId: string | null;
  organisationId: string;
  email: string;
}

interface Sealed<T> {
  value: T;
  expiresAt: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

export class SessionService {
  private readonly key: Promise<CryptoKey>;

  constructor(private readonly secret: string, private readonly now: () => Date = () => new Date()) {
    if (secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
    this.key = crypto.subtle
      .digest("SHA-256", encoder.encode(secret))
      .then((raw) => crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]));
  }

  async sealPending(value: PendingSession): Promise<string> {
    return this.seal({ value, expiresAt: this.now().getTime() + 10 * 60_000 });
  }

  async openPending(token: string): Promise<PendingSession | null> {
    return this.open<PendingSession>(token);
  }

  async sealApplication(value: ApplicationSession): Promise<string> {
    return this.seal({ value, expiresAt: this.now().getTime() + 60 * 60_000 });
  }

  async openApplication(token: string): Promise<ApplicationSession | null> {
    return this.open<ApplicationSession>(token);
  }

  pendingCookie(token: string): string {
    return `kitco_pending=${token}; Path=/api; Max-Age=600; HttpOnly; Secure; SameSite=Lax`;
  }

  applicationCookie(token: string): string {
    return `kitco_session=${token}; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax`;
  }

  clearApplicationCookie(): string {
    return "kitco_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax";
  }

  clearPendingCookie(): string {
    return "kitco_pending=; Path=/api; Max-Age=0; HttpOnly; Secure; SameSite=Lax";
  }

  readCookie(header: string | undefined, name: string): string | null {
    if (!header) return null;
    for (const part of header.split(";")) {
      const [key, ...rest] = part.trim().split("=");
      if (key === name) return rest.join("=") || null;
    }
    return null;
  }

  private async seal<T>(payload: Sealed<T>): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await this.key, encoder.encode(JSON.stringify(payload))),
    );
    const combined = new Uint8Array(iv.length + ciphertext.length);
    combined.set(iv);
    combined.set(ciphertext, iv.length);
    return base64Url(combined);
  }

  private async open<T>(token: string): Promise<T | null> {
    try {
      const combined = fromBase64Url(token);
      if (combined.length < 29) return null;
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: combined.slice(0, 12) },
        await this.key,
        combined.slice(12),
      );
      const payload = JSON.parse(decoder.decode(plaintext)) as Sealed<T>;
      if (!Number.isFinite(payload.expiresAt) || payload.expiresAt <= this.now().getTime()) return null;
      return payload.value;
    } catch {
      return null;
    }
  }
}
