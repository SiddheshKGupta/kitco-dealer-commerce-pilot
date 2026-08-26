export async function postJson<T>(path: string, body: object): Promise<T> {
	const response = await fetch(path, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
	const payload = await response.json().catch(() => ({})) as T & { error?: string };
	if (!response.ok) throw new Error(payload.error ?? "REQUEST_FAILED");
	return payload;
}

/** INVALID_CREDENTIALS deliberately reads the same for an unknown Dealer Code, a wrong
 *  password and a suspended account: the copy must not tell an attacker which shops are
 *  KITCO dealers (V5_AUTH_FLOW.md §4). */
const MESSAGES: Record<string, string> = {
	INVALID_CREDENTIALS: "Those sign-in details are incorrect. Check your Dealer Code and password, or contact KITCO.",
	INVALID_LOGIN_REQUEST: "Enter your Dealer Code and your password.",
	PASSWORD_TOO_SHORT: "Your password must be at least 12 characters.",
	PASSWORD_UNCHANGED: "Choose a password you have not used here before.",
	UNAUTHENTICATED: "That took too long. Sign in again to continue.",
	EMAIL_DELIVERY_FAILED: "We could not send your code. Try again shortly.",
	OTP_RESEND_COOLDOWN: "A code was sent recently. Wait a moment before asking for another.",
	OTP_INVALID: "That code is not right. Check it and try again.",
	OTP_EXPIRED: "That code has expired. Ask for a new one.",
	OTP_ALREADY_CONSUMED: "That code has already been used. Ask for a new one.",
	OTP_ATTEMPTS_EXHAUSTED: "Too many tries. Ask for a new code.",
	PENDING_SESSION_REQUIRED: "That took too long. Start again from the sign-in screen.",
	INVALID_REGISTRATION_REQUEST: "Check the highlighted details and try again.",
	APPLICATION_NOT_FOUND: "We could not find that application.",
	APPLICATION_ALREADY_SUBMITTED: "This application has already been submitted.",
};

export function errorMessage(code: string): string {
	return MESSAGES[code] ?? "We could not complete that step. Try again.";
}
