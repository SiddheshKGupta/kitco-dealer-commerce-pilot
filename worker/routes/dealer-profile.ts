import type { Hono } from "hono";
import { z } from "zod";
import { isProfileComplete, missingProfileFields } from "../../src/domain/dealer-profile";
import { GSTIN_REGEX } from "../../src/domain/gstin";
import type { AuthVariables } from "../middleware/auth";
import { ApiError } from "../middleware/errors";
import type { DealerProfileRecord, DealerProfileStore } from "../supabase-dealer-profile";
import { parseBody } from "./shared";

/** Writes the storefront photo into the same private bucket as catalogue media.
 *  Keys are organisation-prefixed so the existing GET /api/media/:key guard --
 *  which refuses any key outside the caller's organisation -- protects them too. */
export interface StorefrontPhotoUploader {
  put(scopedKey: string, body: ArrayBuffer, contentType: string): Promise<void>;
}

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const optionalText = (max: number) => z.string().trim().max(max).optional();

const updateSchema = z.object({
  // Structural check only (state code, PAN shape, entity code, the fixed "Z")
  // -- see docs/spec/V5_GST_INTEGRATION.md §6. The checksum digit is
  // deliberately NOT validated: there is no GST provider wired yet, and
  // rejecting on it locally could block a legitimate number the provider
  // would accept.
  gstin: z.string().trim().toUpperCase().regex(GSTIN_REGEX, "A GST number is 15 letters and digits in the standard state/PAN/entity format").optional(),
  addressLine1: optionalText(200),
  addressLine2: z.string().trim().max(200).nullable().optional(),
  city: optionalText(100),
  state: optionalText(100),
  pinCode: z.string().trim().regex(/^[0-9]{6}$/u, "A PIN code is 6 digits").optional(),
  contactPerson: optionalText(200),
  mobile: z.string().trim().regex(/^[6-9][0-9]{9}$/u, "A mobile number is 10 digits, starting with 6-9").optional(),
  secondaryEmail: z.union([z.string().trim().email().max(254), z.literal("")]).nullable().optional(),
}).strict();

/** Every profile response carries the gate state, so the dealer screen never has
 *  to recompute "can I order yet?" and drift from the rule that actually blocks
 *  submission. */
function withCompleteness(profile: DealerProfileRecord) {
  return {
    profile,
    profileComplete: isProfileComplete(profile),
    missingFields: missingProfileFields(profile),
  };
}

export function registerDealerProfileRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  store?: DealerProfileStore,
  photos?: StorefrontPhotoUploader,
): void {
  if (!store) return;

  app.get("/api/dealer/profile", async (context) =>
    context.json(withCompleteness(await store.get(context.get("session")))));

  app.put("/api/dealer/profile", async (context) => {
    const input = await parseBody(context, updateSchema);
    const updated = await store.update(
      context.get("session"),
      { ...input, secondaryEmail: input.secondaryEmail === "" ? null : input.secondaryEmail },
      context.get("correlationId"),
    );
    return context.json(withCompleteness(updated));
  });

  app.post("/api/dealer/profile/photo", async (context) => {
    if (!photos) throw new ApiError(502, "PHOTO_UPLOAD_UNAVAILABLE", "Photo upload is not available right now");
    const session = context.get("session");
    if (!session.dealerId) throw new ApiError(403, "DEALER_REQUIRED", "Dealer access is required");

    const contentType = (context.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const extension = PHOTO_TYPES[contentType];
    if (!extension) throw new ApiError(400, "UNSUPPORTED_IMAGE_TYPE", "Upload a JPG, PNG or WEBP photo");

    const body = await context.req.arrayBuffer();
    if (body.byteLength === 0) throw new ApiError(400, "EMPTY_UPLOAD", "That photo appears to be empty");
    if (body.byteLength > MAX_PHOTO_BYTES) throw new ApiError(400, "IMAGE_TOO_LARGE", "Photos must be 5 MB or smaller");

    // Timestamped rather than a stable key so a replacement is never served from
    // a stale cache. The superseded object is left in place; reaping orphans is a
    // storage-lifecycle concern, not a request-path one.
    const scopedKey = `${session.organisationId}/dealers/${session.dealerId}/storefront-${Date.now()}.${extension}`;
    await photos.put(scopedKey, body, contentType);
    return context.json(withCompleteness(await store.setStorefrontPhoto(session, scopedKey, context.get("correlationId"))));
  });
}
