import type { SupabaseClient } from "@supabase/supabase-js";
import type { NoticeMailer } from "./auth/resend-provider";
import type { SessionIdentity } from "./middleware/auth";
import { ApiError } from "./middleware/errors";
import type { DealerApplicationRow, DealerApplicationsAdmin } from "./routes/admin-dealer-applications";
import type { AdminDealersStore } from "./routes/admin-dealers";

type Row = Record<string, any>;

export function slugCode(businessName: string): string {
	const letters = businessName.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
	return (letters.slice(0, 6) || "DEALER") + Math.floor(1000 + Math.random() * 9000);
}

export class SupabaseDealerApplicationsAdmin implements DealerApplicationsAdmin {
	constructor(
		private readonly client: SupabaseClient,
		private readonly mailer?: NoticeMailer,
		private readonly portalUrl = "https://partners.kitco.co.in",
		// Auth v5 replaced self-service /activate (email + OTP, no password) with
		// KITCO-issued Dealer Code + password. Approving an application used to be
		// enough on its own -- the dealer could self-activate -- but under v5 an
		// approval that stops here creates a dealer with no auth user and no way in
		// at all. issueCredentials() closes that loop in the same action, so
		// approving *is* onboarding, not the first of several separate admin steps.
		private readonly adminDealers?: AdminDealersStore,
	) {}

	/** Tells the applicant what KITCO decided. Deliberately never throws: the
	 *  decision is already committed and audited, and a bounced mailbox must not
	 *  turn an approved dealer into a 502 the admin has to guess about. */
	private async notify(to: string, correlationId: string, subject: string, text: string): Promise<void> {
		if (!this.mailer) return;
		try {
			await this.mailer.sendNotice({ to, subject, text, correlationId });
		} catch {
			console.error("dealer_application.notice_failed", { correlationId });
		}
	}

	private async audit(session: SessionIdentity, correlationId: string, eventType: string, applicationId: string, evidence: Record<string, unknown>) {
		await this.client.from("audit_events").insert({
			organisation_id: session.organisationId,
			dealer_id: null,
			actor_auth_user_id: session.userId,
			event_type: eventType,
			entity_type: "dealer_application",
			entity_id: applicationId,
			correlation_id: correlationId,
			evidence,
		});
	}

	async list(session: SessionIdentity): Promise<DealerApplicationRow[]> {
		const { data, error } = await this.client
			.from("dealer_applications")
			.select("id,business_name,gstin,city,state,contact_person,primary_email,secondary_email,mobile,status,review_notes,created_at")
			.eq("organisation_id", session.organisationId)
			.order("created_at", { ascending: false });
		if (error) throw new ApiError(502, "APPLICATION_LOAD_FAILED", "Applications could not be loaded");
		return (data as Row[]).map((row) => ({
			id: String(row.id), businessName: String(row.business_name), gstin: String(row.gstin),
			city: String(row.city), state: String(row.state), contactPerson: String(row.contact_person),
			primaryEmail: String(row.primary_email), secondaryEmail: row.secondary_email ? String(row.secondary_email) : null,
			mobile: String(row.mobile), status: String(row.status), reviewNotes: row.review_notes ? String(row.review_notes) : null,
			createdAt: String(row.created_at),
		}));
	}

	private async loadReviewable(session: SessionIdentity, applicationId: string): Promise<Row> {
		const { data, error } = await this.client.from("dealer_applications").select("*")
			.eq("id", applicationId).eq("organisation_id", session.organisationId).maybeSingle();
		if (error) throw new ApiError(502, "APPLICATION_LOAD_FAILED", "Application could not be loaded");
		if (!data) throw new ApiError(404, "APPLICATION_NOT_FOUND", "Application not found");
		if (!["SUBMITTED", "UNDER_REVIEW", "MORE_INFO_REQUIRED"].includes(data.status)) {
			throw new ApiError(409, "APPLICATION_NOT_REVIEWABLE", "This application has already been decided");
		}
		return data as Row;
	}

	/** Resolves a GSTIN to a v5 gst_registrations row, reusing an existing one:
	 *  Indian GST issues one GSTIN per PAN per state, so a group's outlets in one
	 *  state legitimately share a registration. Mirrors the dealer profile store. */
	private async resolveGstRegistration(session: SessionIdentity, gstin: string): Promise<string> {
		const normalised = gstin.trim().toUpperCase().replaceAll(/\s+/g, "");
		const { data: existing } = await this.client.from("gst_registrations")
			.select("id").eq("organisation_id", session.organisationId).eq("gstin", normalised).maybeSingle();
		if (existing) return String(existing.id);
		const { data: created, error } = await this.client.from("gst_registrations")
			.insert({ organisation_id: session.organisationId, gstin: normalised, verification_status: "UNVERIFIED" })
			.select("id").maybeSingle();
		if (error?.code === "23505") {
			const { data: raced } = await this.client.from("gst_registrations")
				.select("id").eq("organisation_id", session.organisationId).eq("gstin", normalised).maybeSingle();
			if (raced) return String(raced.id);
		}
		if (error || !created) throw new ApiError(502, "DEALER_CREATE_FAILED", "GST registration could not be recorded");
		return String(created.id);
	}

	async approve(session: SessionIdentity, applicationId: string, correlationId: string): Promise<{ dealerId: string }> {
		const application = await this.loadReviewable(session, applicationId);
		const gstRegistrationId = await this.resolveGstRegistration(session, String(application.gstin));

		let dealerId: string | null = null;
		for (let attempt = 0; attempt < 3 && !dealerId; attempt += 1) {
			const { data, error } = await this.client.from("dealers").insert({
				organisation_id: session.organisationId,
				code: slugCode(String(application.business_name)),
				name: application.business_name,
				city: application.city,
				state: application.state,
				master_email: application.primary_email,
				// The applicant already supplied everything the order gate asks for,
				// so carry it across. Making an approved dealer retype their own
				// address before they can order would be gratuitous.
				address_line1: application.address_line1,
				address_line2: application.address_line2,
				pin_code: application.pin_code,
				contact_person: application.contact_person,
				mobile: application.mobile,
				secondary_email: application.secondary_email,
				gst_registration_id: gstRegistrationId,
				source_system: "DEALER_APPLICATION",
				source_reference: applicationId,
				activation_status: "UNACTIVATED",
			}).select("id").maybeSingle();
			if (!error && data) dealerId = String(data.id);
			else if (error && error.code !== "23505") throw new ApiError(502, "DEALER_CREATE_FAILED", "Dealer could not be created");
		}
		if (!dealerId) throw new ApiError(502, "DEALER_CREATE_FAILED", "Dealer could not be created");

		// Written alongside the v5 table because the admin console and the orders
		// CSV export still read this one. Reconciling the two is a v5 data-model
		// job, not something to do silently inside an approval.
		const { error: gstError } = await this.client.from("dealer_gst_registrations").insert({
			organisation_id: session.organisationId, dealer_id: dealerId, gstin: application.gstin, is_primary: true,
		});
		if (gstError) throw new ApiError(502, "DEALER_CREATE_FAILED", "GST registration could not be recorded");

		// Issued before the application is marked APPROVED: if this fails, the
		// application stays reviewable and the admin sees a real error to retry,
		// rather than a "successful" approval that quietly produced a dealer nobody
		// can sign in as.
		const credentials = this.adminDealers
			? await this.adminDealers.issueCredentials(session, dealerId, correlationId)
			: null;

		const { error: updateError } = await this.client.from("dealer_applications").update({
			status: "APPROVED", reviewed_by: session.userId, reviewed_at: new Date().toISOString(), created_dealer_id: dealerId,
		}).eq("id", applicationId);
		if (updateError) throw new ApiError(502, "APPLICATION_UPDATE_FAILED", "Application could not be updated");
		await this.audit(session, correlationId, "DEALER_APPLICATION_APPROVED", applicationId, { dealerId, businessName: application.business_name });
		await this.notify(String(application.primary_email), correlationId,
			"Your KITCO dealer registration is approved",
			credentials
				? `KITCO has approved your registration for ${application.business_name}.\n\n` +
					`Sign in at ${this.portalUrl}/login with:\n\n` +
					`Dealer Code: ${credentials.dealerCode}\n` +
					`Password: ${credentials.password}\n\n` +
					`You'll be sent a one-time code by email to confirm it's you, and asked to choose your own password on your first sign-in.`
				: `KITCO has approved your registration for ${application.business_name}.\n\n` +
					`KITCO will be in touch shortly with your sign-in details.`);
		return { dealerId };
	}

	async reject(session: SessionIdentity, applicationId: string, notes: string, correlationId: string): Promise<void> {
		const application = await this.loadReviewable(session, applicationId);
		const { error } = await this.client.from("dealer_applications").update({
			status: "REJECTED", reviewed_by: session.userId, reviewed_at: new Date().toISOString(), review_notes: notes,
		}).eq("id", applicationId);
		if (error) throw new ApiError(502, "APPLICATION_UPDATE_FAILED", "Application could not be updated");
		await this.audit(session, correlationId, "DEALER_APPLICATION_REJECTED", applicationId, { notes, businessName: application.business_name });
		await this.notify(String(application.primary_email), correlationId,
			"About your KITCO dealer registration",
			`KITCO has reviewed your registration for ${application.business_name} and is not able to proceed.\n\n${notes}`);
	}

	async requestMoreInfo(session: SessionIdentity, applicationId: string, notes: string, correlationId: string): Promise<void> {
		const application = await this.loadReviewable(session, applicationId);
		const { error } = await this.client.from("dealer_applications").update({
			status: "MORE_INFO_REQUIRED", reviewed_by: session.userId, reviewed_at: new Date().toISOString(), review_notes: notes,
		}).eq("id", applicationId);
		if (error) throw new ApiError(502, "APPLICATION_UPDATE_FAILED", "Application could not be updated");
		await this.audit(session, correlationId, "DEALER_APPLICATION_MORE_INFO_REQUESTED", applicationId, { notes, businessName: application.business_name });
		await this.notify(String(application.primary_email), correlationId,
			"KITCO needs a little more about your registration",
			`KITCO is reviewing your registration for ${application.business_name} and needs more information.\n\n${notes}\n\n` +
			`Reply to this email with the details and KITCO will continue the review.`);
	}
}
