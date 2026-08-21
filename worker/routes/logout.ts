import type { Hono } from "hono";
import type { SessionService } from "../auth/session";

export function registerLogoutRoutes(app: Hono<any>, sessions: SessionService): void {
	app.post("/api/logout", (context) => {
		context.header("Set-Cookie", sessions.clearApplicationCookie());
		context.header("Set-Cookie", sessions.clearPendingCookie(), { append: true });
		return context.json({ loggedOut: true });
	});
}
