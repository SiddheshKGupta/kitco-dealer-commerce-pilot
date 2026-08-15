import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { SupabaseDealerApplicationsAdmin } from "../../worker/supabase-dealer-applications";
import { admin } from "./fixtures";

type Row = Record<string, any>;

const applicationRow: Row = {
	id: "app-1", organisation_id: "org-1", business_name: "VLCO Sports", gstin: "10ABCDE1234F1Z5",
	city: "Patna", state: "Bihar", primary_email: "owner@vlco.test", status: "SUBMITTED",
};

function makeClient(row: Row = applicationRow) {
	const auditInserts: Row[] = [];
	const applicationUpdates: Row[] = [];
	const from = vi.fn((table: string) => {
		if (table === "dealer_applications") {
			return {
				select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }),
				update: (patch: Row) => ({ eq: async () => { applicationUpdates.push(patch); return { error: null }; } }),
			};
		}
		if (table === "dealers") {
			return { insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: "dealer-new-1" }, error: null }) }) }) };
		}
		if (table === "dealer_gst_registrations") {
			return { insert: async () => ({ error: null }) };
		}
		if (table === "audit_events") {
			return { insert: async (event: Row) => { auditInserts.push(event); return { error: null }; } };
		}
		throw new Error(`unexpected table ${table}`);
	});
	return { client: { from } as unknown as SupabaseClient, auditInserts, applicationUpdates };
}

describe("SupabaseDealerApplicationsAdmin audit trail", () => {
	it("records DEALER_APPLICATION_APPROVED with the new dealer id and business name on approve", async () => {
		const { client, auditInserts } = makeClient();
		const store = new SupabaseDealerApplicationsAdmin(client);

		const result = await store.approve(admin, "app-1", "corr-approve");

		expect(result).toEqual({ dealerId: "dealer-new-1" });
		expect(auditInserts).toEqual([{
			organisation_id: "org-1", dealer_id: null, actor_auth_user_id: admin.userId,
			event_type: "DEALER_APPLICATION_APPROVED", entity_type: "dealer_application", entity_id: "app-1",
			correlation_id: "corr-approve", evidence: { dealerId: "dealer-new-1", businessName: "VLCO Sports" },
		}]);
	});

	it("records DEALER_APPLICATION_REJECTED with the review notes on reject", async () => {
		const { client, auditInserts, applicationUpdates } = makeClient();
		const store = new SupabaseDealerApplicationsAdmin(client);

		await store.reject(admin, "app-1", "GSTIN could not be verified", "corr-reject");

		expect(applicationUpdates).toEqual([expect.objectContaining({ status: "REJECTED", review_notes: "GSTIN could not be verified" })]);
		expect(auditInserts).toEqual([expect.objectContaining({
			event_type: "DEALER_APPLICATION_REJECTED", entity_id: "app-1", correlation_id: "corr-reject",
			evidence: { notes: "GSTIN could not be verified", businessName: "VLCO Sports" },
		})]);
	});

	it("records DEALER_APPLICATION_MORE_INFO_REQUESTED on requestMoreInfo", async () => {
		const { client, auditInserts } = makeClient();
		const store = new SupabaseDealerApplicationsAdmin(client);

		await store.requestMoreInfo(admin, "app-1", "Please attach a signed GSTIN certificate", "corr-more-info");

		expect(auditInserts).toEqual([expect.objectContaining({
			event_type: "DEALER_APPLICATION_MORE_INFO_REQUESTED", entity_id: "app-1", correlation_id: "corr-more-info",
			evidence: { notes: "Please attach a signed GSTIN certificate", businessName: "VLCO Sports" },
		})]);
	});

	it("still blocks reviewing an application that's already been decided, before any audit write", async () => {
		const { client, auditInserts } = makeClient({ ...applicationRow, status: "APPROVED" });
		const store = new SupabaseDealerApplicationsAdmin(client);

		await expect(store.reject(admin, "app-1", "too late", "corr-x")).rejects.toThrow();
		expect(auditInserts).toEqual([]);
	});
});
