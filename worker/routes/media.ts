import type { Hono } from "hono";
import type { AuthVariables } from "../middleware/auth";
import { ApiError } from "../middleware/errors";

export interface MediaStore { get(key: string): Promise<{ body: ReadableStream; contentType: string } | null> }
export function registerMediaRoutes(app: Hono<{ Variables: AuthVariables }>, mediaStore?: MediaStore) {
  app.get("/api/media/:key", async (context) => {
    if (!mediaStore) throw new ApiError(404, "MEDIA_NOT_FOUND", "Media not found");
    const key = decodeURIComponent(context.req.param("key"));
    const session = context.get("session");
    if (!key.startsWith(`${session.organisationId}/`)) throw new ApiError(404, "MEDIA_NOT_FOUND", "Media not found");
    const media = await mediaStore.get(key);
    if (!media) throw new ApiError(404, "MEDIA_NOT_FOUND", "Media not found");
    return new Response(media.body, { headers: { "content-type": media.contentType, "cache-control": "private, max-age=300" } });
  });
}
