import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionIdentity } from "./middleware/auth";
import { ApiError } from "./middleware/errors";
import type { AdminUserRow, AdminUsersStore } from "./routes/admin-users";

/** Internal only -- Supabase's admin.createUser requires a password field, but every
 *  admin account signs in with email + OTP. Nothing ever checks this value. */
function unusedInternalPassword(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(24));
	return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export class SupabaseAdminUsersStore implements AdminUsersStore {
	constructor(private readonly client: SupabaseClient) {}

	private async audit(session: SessionIdentity, correlationId: string, eventType: string, entityId: string, evidence: Record<string, unknown>) {
		await this.client.from("audit_events").insert({
			organisation_id: session.organisationId,
			dealer_id: null,
			actor_auth_user_id: session.userId,
			event_type: eventType,
			entity_type: "app_user",
			entity_id: entityId,
			correlation_id: correlationId,
			evidence,
		});
	}

	async list(session: SessionIdentity): Promise<AdminUserRow[]> {
		const { data, error } = await this.client
			.from("app_users")
			.select("id,auth_user_id,status,created_at")
			.eq("organisation_id", session.organisationId)
			.eq("app_role", "ADMIN")
			.order("created_at", { ascending: true });
		if (error) throw new ApiError(502, "ADMIN_USERS_LOAD_FAILED", "Admin users could not be loaded");
		const rows = data ?? [];
		const emails = await Promise.all(rows.map((row) => this.client.auth.admin.getUserById(String(row.auth_user_id))));
		return rows.map((row, index) => ({
			id: String(row.id),
			email: emails[index]?.data.user?.email ?? "(unknown)",
			status: String(row.status),
			createdAt: String(row.created_at),
		}));
	}

	async create(session: SessionIdentity, email: string, correlationId: string): Promise<{ email: string }> {
		const { data: created, error: createError } = await this.client.auth.admin.createUser({ email, password: unusedInternalPassword(), email_confirm: true });
		if (createError || !created.user) {
			throw new ApiError(409, "ADMIN_USER_CREATE_FAILED", createError?.message?.includes("already been registered") ? "An account with this email already exists" : "Admin account could not be created");
		}
		const { error: insertError } = await this.client.from("app_users").insert({
			organisation_id: session.organisationId,
			dealer_id: null,
			auth_user_id: created.user.id,
			app_role: "ADMIN",
			status: "ACTIVE",
		});
		if (insertError) throw new ApiError(502, "ADMIN_USER_CREATE_FAILED", "Admin account could not be created");
		await this.audit(session, correlationId, "ADMIN_USER_CREATED", created.user.id, { email });
		return { email };
	}

	async setStatus(session: SessionIdentity, userId: string, status: "ACTIVE" | "INACTIVE", correlationId: string): Promise<void> {
		if (status === "INACTIVE") {
			const { count, error: countError } = await this.client
				.from("app_users")
				.select("id", { count: "exact", head: true })
				.eq("organisation_id", session.organisationId).eq("app_role", "ADMIN").eq("status", "ACTIVE");
			if (countError) throw new ApiError(502, "ADMIN_USER_UPDATE_FAILED", "Admin account could not be updated");
			const { data: target } = await this.client.from("app_users").select("status").eq("id", userId).eq("organisation_id", session.organisationId).maybeSingle();
			if ((count ?? 0) <= 1 && target?.status === "ACTIVE") {
				throw new ApiError(409, "LAST_ADMIN_ACTIVE", "At least one active admin account must remain");
			}
		}
		const { error } = await this.client.from("app_users").update({ status }).eq("id", userId).eq("organisation_id", session.organisationId).eq("app_role", "ADMIN");
		if (error) throw new ApiError(502, "ADMIN_USER_UPDATE_FAILED", "Admin account could not be updated");
		await this.audit(session, correlationId, status === "ACTIVE" ? "ADMIN_USER_REACTIVATED" : "ADMIN_USER_DEACTIVATED", userId, { status });
	}
}
