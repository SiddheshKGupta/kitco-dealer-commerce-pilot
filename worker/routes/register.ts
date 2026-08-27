import type { Hono } from "hono";
import { isValidGstin } from "../../src/domain/gstin";
import type { OtpService } from "../auth/otp-service";
import type { SessionService } from "../auth/session";

export interface DealerApplicationInput {
	businessName: string;
	gstin: string;
	addressLine1: string;
	addressLine2?: string;
	city: string;
	state: string;
	pinCode: string;
	contactPerson: string;
	primaryEmail: string;
	secondaryEmail?: string;
	mobile: string;
}

export interface DealerApplicationRecord {
	id: string;
	organisationId: string;
	primaryEmail: string;
	status: string;
}

/** Registration is an application, never an account. A shop fills in the form,
 *  verifies its own email with an OTP, and the application lands in KITCO's
 *  review queue at SUBMITTED. Nothing here grants dealer access: the dealer row
 *  is created only when an admin approves, in SupabaseDealerApplicationsAdmin.
 *
 *  This used to self-activate on OTP verification, which meant anyone on the
 *  internet could register a shop, verify their own address and immediately
 *  browse wholesale pricing. Do not reintroduce that shortcut. */
export interface DealerApplicationStore {
	create(input: DealerApplicationInput): Promise<{ id: string; organisationId: string }>;
	get(applicationId: string): Promise<DealerApplicationRecord | null>;
	submit(applicationId: string): Promise<boolean>;
}

interface RegisterDependencies {
	store: DealerApplicationStore;
	otp: OtpService;
	sessions: SessionService;
}

function isEmail(value: unknown): value is string {
	return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value) && value.length <= 254;
}

function nonEmptyString(value: unknown, max = 200): value is string {
	return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

// A real Indian mobile number: 10 digits, first digit 6-9.
const MOBILE_REGEX = /^[6-9][0-9]{9}$/u;
const PIN_CODE_REGEX = /^[0-9]{6}$/u;

function parseInput(body: unknown): DealerApplicationInput | null {
	if (!body || typeof body !== "object") return null;
	const b = body as Record<string, unknown>;
	if (!nonEmptyString(b.gstin)) return null;
	const gstin = b.gstin.toUpperCase().replaceAll(/\s+/g, "");
	if (
		!nonEmptyString(b.businessName) || !isValidGstin(gstin) || !nonEmptyString(b.addressLine1) ||
		!nonEmptyString(b.city, 100) || !nonEmptyString(b.state, 100) || !nonEmptyString(b.pinCode) || !PIN_CODE_REGEX.test(b.pinCode) ||
		!nonEmptyString(b.contactPerson) || !isEmail(b.primaryEmail) || !nonEmptyString(b.mobile) || !MOBILE_REGEX.test(b.mobile) ||
		(b.secondaryEmail !== undefined && b.secondaryEmail !== "" && !isEmail(b.secondaryEmail)) ||
		(b.addressLine2 !== undefined && typeof b.addressLine2 !== "string")
	) return null;
	return {
		businessName: b.businessName as string, gstin,
		addressLine1: b.addressLine1 as string, addressLine2: (b.addressLine2 as string | undefined) || undefined,
		city: b.city as string, state: b.state as string, pinCode: b.pinCode as string,
		contactPerson: b.contactPerson as string, primaryEmail: (b.primaryEmail as string).trim().toLowerCase(),
		secondaryEmail: b.secondaryEmail ? (b.secondaryEmail as string).trim().toLowerCase() : undefined,
		mobile: b.mobile as string,
	};
}

export function registerRegistrationRoutes(app: Hono<any>, dependencies: RegisterDependencies): void {
	app.post("/api/register", async (context) => {
		const body = await context.req.json().catch(() => null);
		const input = parseInput(body);
		if (!input) return context.json({ error: "INVALID_REGISTRATION_REQUEST" }, 400);
		const application = await dependencies.store.create(input);
		return context.json({ applicationId: application.id }, 201);
	});

	app.post("/api/register/:applicationId/otp", async (context) => {
		const applicationId = context.req.param("applicationId");
		const application = await dependencies.store.get(applicationId);
		if (!application) return context.json({ error: "APPLICATION_NOT_FOUND" }, 404);
		if (application.status !== "DRAFT") return context.json({ error: "APPLICATION_ALREADY_SUBMITTED" }, 409);
		try {
			const challenge = await dependencies.otp.issue({
				organisationId: application.organisationId,
				dealerId: null,
				to: application.primaryEmail,
				purpose: "REGISTRATION",
				enforceCooldown: true,
			});
			const pending = await dependencies.sessions.sealPending({
				kind: "registration",
				challengeId: challenge.id,
				applicationId,
				organisationId: application.organisationId,
				email: application.primaryEmail,
			});
			context.header("Set-Cookie", dependencies.sessions.pendingCookie(pending));
			return context.json({ otpRequired: true, challengeId: challenge.id }, 202);
		} catch (error) {
			const message = error instanceof Error ? error.message : "EMAIL_DELIVERY_FAILED";
			if (message === "OTP_RESEND_COOLDOWN") return context.json({ error: message }, 429);
			return context.json({ error: "EMAIL_DELIVERY_FAILED" }, 502);
		}
	});
}
