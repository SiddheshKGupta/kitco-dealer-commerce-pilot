import type { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables, SessionIdentity } from "../middleware/auth";
import { parseBody } from "./shared";

export interface AdminUserRow {
	id: string;
	email: string;
	status: string;
	mustChangePassword: boolean;
	createdAt: string;
}

/** Every admin is a named, individually-authenticated account -- no shared
 *  credentials. Creating/deactivating one is itself an audited action. */
export interface AdminUsersStore {
	list(session: SessionIdentity): Promise<AdminUserRow[]>;
	create(session: SessionIdentity, email: string, correlationId: string): Promise<{ email: string; tempPassword: string }>;
	setStatus(session: SessionIdentity, userId: string, status: "ACTIVE" | "INACTIVE", correlationId: string): Promise<void>;
}

const createSchema = z.object({ email: z.string().trim().email() }).strict();
const statusSchema = z.object({ status: z.enum(["ACTIVE", "INACTIVE"]) }).strict();

export function registerAdminUserRoutes(app: Hono<{ Variables: AuthVariables }>, store?: AdminUsersStore): void {
	if (!store) return;
	app.get("/api/admin/users", async (context) => context.json({ users: await store.list(context.get("session")) }));

	app.post("/api/admin/users", async (context) => {
		const input = await parseBody(context, createSchema);
		const result = await store.create(context.get("session"), input.email.toLowerCase(), context.get("correlationId"));
		return context.json(result, 201);
	});

	app.post("/api/admin/users/:id/status", async (context) => {
		const input = await parseBody(context, statusSchema);
		await store.setStatus(context.get("session"), context.req.param("id"), input.status, context.get("correlationId"));
		return context.json({ ok: true });
	});
}
