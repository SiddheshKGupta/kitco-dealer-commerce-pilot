export type OtpPurpose = "ACTIVATION" | "LOGIN";

export async function postJson<T>(path: string, body: object): Promise<T> {
	const response = await fetch(path, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
	const payload = await response.json().catch(() => ({})) as T & { error?: string };
	if (!response.ok) throw new Error(payload.error ?? "REQUEST_FAILED");
	return payload;
}

export function errorMessage(code: string): string {
	return ({ ACTIVATION_NOT_AUTHORISED: "That pilot access code is not valid.", EMAIL_DELIVERY_FAILED: "We could not send your verification code. Try again shortly.", INVALID_CREDENTIALS: "Your email or password is incorrect.", PASSWORD_TOO_SHORT: "Your password must be at least 12 characters.", OTP_RESEND_COOLDOWN: "A new code was sent recently. Please wait before requesting another.", DEALER_ALREADY_ACTIVE: "This dealership is already active.", DEALER_NOT_FOUND: "We could not find that dealership.", OTP_INVALID: "That code is not valid. Check it and try again.", INVALID_REGISTRATION_REQUEST: "Check the highlighted details and try again.", APPLICATION_NOT_FOUND: "We could not find that application.", APPLICATION_ALREADY_SUBMITTED: "This application has already been submitted." } as Record<string, string>)[code] ?? "We could not complete that step. Try again.";
}
