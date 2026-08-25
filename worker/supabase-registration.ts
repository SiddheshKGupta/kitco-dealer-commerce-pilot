import type { SupabaseClient } from "@supabase/supabase-js";
import type { DealerApplicationInput, DealerApplicationRecord, DealerApplicationStore } from "./routes/register";

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
}
