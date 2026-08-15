import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionIdentity } from "./middleware/auth";
import { ApiError } from "./middleware/errors";
import type { DealerApplicationRow, DealerApplicationsAdmin } from "./routes/admin-dealer-applications";

type Row = Record<string, any>;

export function slugCode(businessName: string): string {
	const letters = businessName.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
	return (letters.slice(0, 6) || "DEALER") + Math.floor(1000 + Math.random() * 9000);
}

export class SupabaseDealerApplicationsAdmin implements DealerApplicationsAdmin {
	constructor(private readonly client: SupabaseClient) {}

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

	async approve(session: SessionIdentity, applicationId: string, correlationId: string): Promise<{ dealerId: string }> {
		const application = await this.loadReviewable(session, applicationId);
		let dealerId: string | null = null;
		for (let attempt = 0; attempt < 3 && !dealerId; attempt += 1) {
			const { data, error } = await this.client.from("dealers").insert({
				organisation_id: session.organisationId,
				code: slugCode(String(application.business_name)),
				name: application.business_name,
				city: application.city,
				state: application.state,
				master_email: application.primary_email,
				activation_status: "UNACTIVATED",
			}).select("id").maybeSingle();
			if (!error && data) dealerId = String(data.id);
			else if (error && error.code !== "23505") throw new ApiError(502, "DEALER_CREATE_FAILED", "Dealer could not be created");
		}
		if (!dealerId) throw new ApiError(502, "DEALER_CREATE_FAILED", "Dealer could not be created");

		const { error: gstError } = await this.client.from("dealer_gst_registrations").insert({
			organisation_id: session.organisationId, dealer_id: dealerId, gstin: application.gstin, is_primary: true,
		});
		if (gstError) throw new ApiError(502, "DEALER_CREATE_FAILED", "GST registration could not be recorded");

		const { error: updateError } = await this.client.from("dealer_applications").update({
			status: "APPROVED", reviewed_by: session.userId, reviewed_at: new Date().toISOString(), created_dealer_id: dealerId,
		}).eq("id", applicationId);
		if (updateError) throw new ApiError(502, "APPLICATION_UPDATE_FAILED", "Application could not be updated");
		await this.audit(session, correlationId, "DEALER_APPLICATION_APPROVED", applicationId, { dealerId, businessName: application.business_name });
		return { dealerId };
	}

	async reject(session: SessionIdentity, applicationId: string, notes: string, correlationId: string): Promise<void> {
		const application = await this.loadReviewable(session, applicationId);
		const { error } = await this.client.from("dealer_applications").update({
			status: "REJECTED", reviewed_by: session.userId, reviewed_at: new Date().toISOString(), review_notes: notes,
		}).eq("id", applicationId);
		if (error) throw new ApiError(502, "APPLICATION_UPDATE_FAILED", "Application could not be updated");
		await this.audit(session, correlationId, "DEALER_APPLICATION_REJECTED", applicationId, { notes, businessName: application.business_name });
	}

	async requestMoreInfo(session: SessionIdentity, applicationId: string, notes: string, correlationId: string): Promise<void> {
		const application = await this.loadReviewable(session, applicationId);
		const { error } = await this.client.from("dealer_applications").update({
			status: "MORE_INFO_REQUIRED", reviewed_by: session.userId, reviewed_at: new Date().toISOString(), review_notes: notes,
		}).eq("id", applicationId);
		if (error) throw new ApiError(502, "APPLICATION_UPDATE_FAILED", "Application could not be updated");
		await this.audit(session, correlationId, "DEALER_APPLICATION_MORE_INFO_REQUESTED", applicationId, { notes, businessName: application.business_name });
	}
}
