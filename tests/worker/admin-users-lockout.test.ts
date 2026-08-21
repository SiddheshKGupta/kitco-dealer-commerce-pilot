import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { SupabaseAdminUsersStore } from "../../worker/supabase-admin-users";
import { admin } from "./fixtures";

type Row = Record<string, any>;

function makeClient(activeAdminCount: number, targetStatus: string) {
	const updates: Row[] = [];
	const auditInserts: Row[] = [];
	const countEq = vi.fn(() => ({ eq: countEq2 }));
	const countEq2 = vi.fn(() => ({ eq: async () => ({ count: activeAdminCount, error: null }) }));
	const from = vi.fn((table: string) => {
		if (table === "app_users") {
			return {
				select: (_columns: string, opts?: { count?: string }) => opts?.count
					? { eq: countEq }
					: { eq: () => ({ maybeSingle: async () => ({ data: { status: targetStatus }, error: null }) }) },
				update: (patch: Row) => ({ eq: () => ({ eq: () => ({ eq: async () => { updates.push(patch); return { error: null }; } }) }) }),
			};
		}
		if (table === "audit_events") return { insert: async (event: Row) => { auditInserts.push(event); return { error: null }; } };
		throw new Error(`unexpected table ${table}`);
	});
	return { client: { from } as unknown as SupabaseClient, updates, auditInserts, countEq };
}

describe("SupabaseAdminUsersStore.setStatus -- last-admin lockout guard", () => {
	it("blocks deactivating the sole remaining active admin", async () => {
		const { client, updates, auditInserts } = makeClient(1, "ACTIVE");
		const store = new SupabaseAdminUsersStore(client);

		await expect(store.setStatus(admin, "user-1", "INACTIVE", "corr-x")).rejects.toMatchObject({ code: "LAST_ADMIN_ACTIVE", status: 409 });
		expect(updates).toEqual([]);
		expect(auditInserts).toEqual([]);
	});

	it("allows deactivating an admin when at least one other active admin remains", async () => {
		const { client, updates, auditInserts } = makeClient(2, "ACTIVE");
		const store = new SupabaseAdminUsersStore(client);

		await store.setStatus(admin, "user-1", "INACTIVE", "corr-x");

		expect(updates).toEqual([{ status: "INACTIVE" }]);
		expect(auditInserts).toEqual([expect.objectContaining({ event_type: "ADMIN_USER_DEACTIVATED", entity_id: "user-1" })]);
	});

	it("does not apply the lockout guard when the target is already inactive, even if only one active admin exists", async () => {
		const { client, updates } = makeClient(1, "INACTIVE");
		const store = new SupabaseAdminUsersStore(client);

		await store.setStatus(admin, "user-1", "INACTIVE", "corr-x");

		expect(updates).toEqual([{ status: "INACTIVE" }]);
	});

	it("skips the active-admin-count check entirely when reactivating (the guard only exists for deactivation)", async () => {
		const { client, countEq, updates } = makeClient(0, "INACTIVE");
		const store = new SupabaseAdminUsersStore(client);

		await store.setStatus(admin, "user-1", "ACTIVE", "corr-x");

		expect(countEq).not.toHaveBeenCalled();
		expect(updates).toEqual([{ status: "ACTIVE" }]);
	});
});
