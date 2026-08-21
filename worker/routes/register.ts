import type { Hono } from "hono";
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

/** Pilot only: a submitted application self-activates on OTP verification --
 *  no admin approval gate. approveAndActivate() creates the canonical dealer
 *  row ACTIVE and links the given auth user, so the applicant can order immediately. */
export interface DealerApplicationStore {
	create(input: DealerApplicationInput): Promise<{ id: string; organisationId: string }>;
	get(applicationId: string): Promise<DealerApplicationRecord | null>;
	submit(applicationId: string): Promise<boolean>;
	approveAndActivate(applicationId: string, authUserId: string): Promise<{ dealerId: string; organisationId: string } | null>;
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

function parseInput(body: unknown): DealerApplicationInput | null {
	if (!body || typeof body !== "object") return null;
	const b = body as Record<string, unknown>;
	if (
		!nonEmptyString(b.businessName) || !nonEmptyString(b.gstin, 15) || !nonEmptyString(b.addressLine1) ||
		!nonEmptyString(b.city, 100) || !nonEmptyString(b.state, 100) || !nonEmptyString(b.pinCode, 10) ||
		!nonEmptyString(b.contactPerson) || !isEmail(b.primaryEmail) || !nonEmptyString(b.mobile, 20) ||
		(b.secondaryEmail !== undefined && b.secondaryEmail !== "" && !isEmail(b.secondaryEmail)) ||
		(b.addressLine2 !== undefined && typeof b.addressLine2 !== "string")
	) return null;
	return {
		businessName: b.businessName as string, gstin: (b.gstin as string).toUpperCase().replaceAll(/\s+/g, ""),
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
		} catch {
			return context.json({ error: "EMAIL_DELIVERY_FAILED" }, 502);
		}
	});
}
