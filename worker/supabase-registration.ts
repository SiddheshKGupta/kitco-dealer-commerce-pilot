import type { SupabaseClient } from "@supabase/supabase-js";
import type { DealerApplicationInput, DealerApplicationRecord, DealerApplicationStore } from "./routes/register";
import { slugCode } from "./supabase-dealer-applications";

export class SupabaseDealerApplicationStore implements DealerApplicationStore {
	constructor(private readonly client: SupabaseClient) {}

	async create(input: DealerApplicationInput): Promise<{ id: string; organisationId: string }> {
		const { data: org, error: orgError } = await this.client.from("organisations").select("id").limit(1).single();
		if (orgError || !org) throw new Error("ORGANISATION_NOT_FOUND");
		const { data, error } = await this.client.from("dealer_applications").insert({
			organisation_id: org.id,
			business_name: input.businessName,
			gstin: input.gstin,
			address_line1: input.addressLine1,
			address_line2: input.addressLine2 ?? null,
			city: input.city,
			state: input.state,
			pin_code: input.pinCode,
			contact_person: input.contactPerson,
			primary_email: input.primaryEmail,
			secondary_email: input.secondaryEmail ?? null,
			mobile: input.mobile,
			status: "DRAFT",
		}).select("id,organisation_id").single();
		if (error || !data) throw new Error("APPLICATION_CREATE_FAILED");
		return { id: String(data.id), organisationId: String(data.organisation_id) };
	}

	async get(applicationId: string): Promise<DealerApplicationRecord | null> {
		const { data, error } = await this.client.from("dealer_applications")
			.select("id,organisation_id,primary_email,status").eq("id", applicationId).maybeSingle();
		if (error) throw new Error("APPLICATION_LOOKUP_FAILED");
		if (!data) return null;
		return { id: String(data.id), organisationId: String(data.organisation_id), primaryEmail: String(data.primary_email), status: String(data.status) };
	}

	async submit(applicationId: string): Promise<boolean> {
		const { data, error } = await this.client.from("dealer_applications")
			.update({ status: "SUBMITTED", primary_email_verified_at: new Date().toISOString() })
			.eq("id", applicationId).eq("status", "DRAFT").select("id");
		if (error) throw new Error("APPLICATION_SUBMIT_FAILED");
		return (data?.length ?? 0) === 1;
	}

	async approveAndActivate(applicationId: string, authUserId: string): Promise<{ dealerId: string; organisationId: string } | null> {
		const { data: application, error: applicationError } = await this.client.from("dealer_applications")
			.select("id,organisation_id,business_name,city,state,gstin,primary_email,status")
			.eq("id", applicationId).eq("status", "DRAFT").maybeSingle();
		if (applicationError) throw new Error("APPLICATION_LOOKUP_FAILED");
		if (!application) return null;

		let dealerId: string | null = null;
		for (let attempt = 0; attempt < 3 && !dealerId; attempt += 1) {
			const { data, error } = await this.client.from("dealers").insert({
				organisation_id: application.organisation_id,
				code: slugCode(String(application.business_name)),
				name: application.business_name,
				city: application.city,
				state: application.state,
				master_email: application.primary_email,
				activation_status: "ACTIVE",
				activated_at: new Date().toISOString(),
			}).select("id").maybeSingle();
			if (!error && data) dealerId = String(data.id);
			else if (error && error.code !== "23505") throw new Error("DEALER_CREATE_FAILED");
		}
		if (!dealerId) throw new Error("DEALER_CREATE_FAILED");

		const { error: gstError } = await this.client.from("dealer_gst_registrations").insert({
			organisation_id: application.organisation_id, dealer_id: dealerId, gstin: application.gstin, is_primary: true,
		});
		if (gstError) throw new Error("DEALER_CREATE_FAILED");

		const { error: mappingError } = await this.client.from("app_users").insert({
			organisation_id: application.organisation_id, dealer_id: dealerId, auth_user_id: authUserId, app_role: "DEALER",
		});
		if (mappingError) throw new Error("ACTIVATION_MAPPING_FAILED");

		const { error: updateError } = await this.client.from("dealer_applications").update({
			status: "APPROVED", reviewed_at: new Date().toISOString(), created_dealer_id: dealerId,
		}).eq("id", applicationId);
		if (updateError) throw new Error("APPLICATION_UPDATE_FAILED");

		return { dealerId, organisationId: String(application.organisation_id) };
	}
}
