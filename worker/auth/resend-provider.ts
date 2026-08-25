import type { EmailDelivery, EmailOTPProvider, EmailOtpMessage } from "./email-provider";

export interface ResendEnv {
  RESEND_API_KEY?: string;
  OTP_FROM_EMAIL?: string;
  VLCO_TEST_EMAIL?: string;
}

interface SafeLogger {
  info(...values: unknown[]): void;
  error(...values: unknown[]): void;
}

export interface EmailNotice {
  to: string;
  subject: string;
  text: string;
  correlationId: string;
}

/** The slice of the mail provider that non-auth code needs, so a caller cannot
 *  reach for sendOtp() and mint a code outside the OTP service. */
export interface NoticeMailer {
  sendNotice(notice: EmailNotice): Promise<EmailDelivery>;
}

const EMAIL_PATTERN = /[^\s"<>]+@[^\s"<>]+/g;

/** Resend error bodies can echo the recipient back in validation messages;
 *  redact email addresses so diagnostics never leak recipient PII into logs. */
function redactProviderError(body: string): string {
  return body.slice(0, 500).replace(EMAIL_PATTERN, "[redacted]");
}

export class ResendEmailProvider implements EmailOTPProvider {
  private readonly apiKey: string;
  private readonly from: string;

  constructor(
    env: ResendEnv,
    private readonly request: typeof fetch = fetch,
    private readonly logger: SafeLogger = console,
  ) {
    if (!env.RESEND_API_KEY || !env.OTP_FROM_EMAIL) {
      throw new Error("RESEND_API_KEY and OTP_FROM_EMAIL are required");
    }
    this.apiKey = env.RESEND_API_KEY;
    this.from = env.OTP_FROM_EMAIL;
  }

  async sendOtp(message: EmailOtpMessage): Promise<EmailDelivery> {
    return this.send({
      to: message.to,
      subject: `Your KITCO ${message.purpose.toLowerCase().replaceAll("_", " ")} code`,
      text: `Your one-time KITCO code is ${message.code}. It expires shortly and can be used once.`,
      correlationId: message.correlationId,
    });
  }

  /** Plain transactional mail that is not a one-time code -- currently only the
   *  dealer-application decision. Sends immediately with no retry or queue;
   *  Phase 6's notification outbox is what makes delivery durable. */
  async sendNotice(notice: EmailNotice): Promise<EmailDelivery> {
    return this.send(notice);
  }

  private async send({ to, subject, text, correlationId }: EmailNotice): Promise<EmailDelivery> {
    let response: Response;
    try {
      response = await this.request.call(globalThis, "https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "kitco-dealer-commerce/1.0",
        },
        body: JSON.stringify({ from: this.from, to: [to], subject, text }),
      });
    } catch (reason) {
      this.logger.error("otp.email.delivery_failed", { correlationId, provider: "resend", reason: reason instanceof Error ? reason.message : String(reason) });
      throw new Error("EMAIL_DELIVERY_FAILED");
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      this.logger.error("otp.email.delivery_failed", {
        correlationId,
        provider: "resend",
        status: response.status,
        providerError: redactProviderError(errorBody),
      });
      throw new Error("EMAIL_DELIVERY_FAILED");
    }

    const payload = (await response.json()) as { id?: unknown };
    if (typeof payload.id !== "string" || !payload.id) {
      this.logger.error("otp.email.invalid_response", { correlationId, provider: "resend" });
      throw new Error("EMAIL_DELIVERY_FAILED");
    }
    this.logger.info("otp.email.delivered", { correlationId, provider: "resend", deliveryId: payload.id });
    return { deliveryId: payload.id };
  }
}
