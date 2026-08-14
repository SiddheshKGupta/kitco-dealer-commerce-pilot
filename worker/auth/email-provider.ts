export type EmailOtpPurpose = "ACTIVATION" | "LOGIN" | "ORDER_SUBMISSION" | "REVISION_ACCEPTANCE" | "REGISTRATION";

export interface EmailOtpMessage {
  to: string;
  code: string;
  purpose: EmailOtpPurpose;
  correlationId: string;
  challengeId: string;
}

export interface EmailDelivery {
  deliveryId: string;
}

export interface EmailOTPProvider {
  sendOtp(message: EmailOtpMessage): Promise<EmailDelivery>;
}

export class CaptureEmailProvider implements EmailOTPProvider {
  readonly deliveries: EmailOtpMessage[] = [];

  async sendOtp(message: EmailOtpMessage): Promise<EmailDelivery> {
    this.deliveries.push({ ...message });
    return { deliveryId: `capture-${this.deliveries.length}` };
  }
}
