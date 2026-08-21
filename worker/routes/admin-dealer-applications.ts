import type { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables, SessionIdentity } from "../middleware/auth";
import { parseBody } from "./shared";

export interface DealerApplicationRow {
	id: string;
	businessName: string;
	gstin: string;
	city: string;
	state: string;
	contactPerson: string;
	primaryEmail: string;
	secondaryEmail: string | null;
	mobile: string;
	status: string;
	reviewNotes: string | null;
	createdAt: string;
}

/** Approving creates the canonical dealer row and links it back to the
 *  application; the applicant then completes normal activation (v4.0 §12). */
export interface DealerApplicationsAdmin {
	list(session: SessionIdentity): Promise<DealerApplicationRow[]>;
	approve(session: SessionIdentity, applicationId: string, correlationId: string): Promise<{ dealerId: string }>;
	reject(session: SessionIdentity, applicationId: string, notes: string, correlationId: string): Promise<void>;
	requestMoreInfo(session: SessionIdentity, applicationId: string, notes: string, correlationId: string): Promise<void>;
}

const notesSchema = z.object({ notes: z.string().trim().min(1).max(2000) }).strict();

export function registerDealerApplicationRoutes(app: Hono<{ Variables: AuthVariables }>, admin?: DealerApplicationsAdmin): void {
	if (!admin) return;
	app.get("/api/admin/dealer-applications", async (context) =>
		context.json({ applications: await admin.list(context.get("session")) }));

	app.post("/api/admin/dealer-applications/:id/approve", async (context) => {
		const result = await admin.approve(context.get("session"), context.req.param("id"), context.get("correlationId"));
		return context.json(result);
	});

	app.post("/api/admin/dealer-applications/:id/reject", async (context) => {
		const input = await parseBody(context, notesSchema);
		await admin.reject(context.get("session"), context.req.param("id"), input.notes, context.get("correlationId"));
		return context.json({ ok: true });
	});

	app.post("/api/admin/dealer-applications/:id/request-more-info", async (context) => {
		const input = await parseBody(context, notesSchema);
		await admin.requestMoreInfo(context.get("session"), context.req.param("id"), input.notes, context.get("correlationId"));
		return context.json({ ok: true });
	});
}
