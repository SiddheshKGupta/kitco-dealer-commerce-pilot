import type { Hono } from "hono";

export interface PincodeLookupResult {
  found: boolean;
  city?: string;
  state?: string;
}

const PIN_CODE_REGEX = /^[0-9]{6}$/u;

interface PostOfficeResponse {
  Status?: string;
  PostOffice?: Array<{ District?: string; State?: string }> | null;
}

/** Proxies India Post's public PIN-to-locality lookup (no key required) so the
 *  browser never calls a third-party origin directly. Government reference
 *  data, not tenant data -- no organisation scoping applies.
 *
 *  Always fails open: an unknown PIN, a malformed provider response or the
 *  provider being unreachable all come back as `{ found: false }` rather than
 *  an error, so a dealer can always fall back to typing city/state by hand
 *  (V5_GST_INTEGRATION.md's "never a convincing fake one" rule, applied to
 *  "never block on a provider outage" too). */
export function registerPincodeRoutes(app: Hono<any>, fetchImpl: typeof fetch = fetch): void {
  app.get("/api/pincode/:code", async (context) => {
    const code = context.req.param("code");
    if (!PIN_CODE_REGEX.test(code)) return context.json({ error: "INVALID_PINCODE" }, 400);

    try {
      const response = await fetchImpl(`https://api.postalpincode.in/pincode/${code}`);
      if (!response.ok) return context.json({ found: false } satisfies PincodeLookupResult);

      const body = await response.json().catch(() => null) as PostOfficeResponse[] | null;
      const postOffice = body?.[0]?.PostOffice?.[0];
      if (body?.[0]?.Status !== "Success" || !postOffice?.State) return context.json({ found: false } satisfies PincodeLookupResult);

      return context.json({ found: true, city: postOffice.District ?? "", state: postOffice.State } satisfies PincodeLookupResult);
    } catch {
      return context.json({ found: false } satisfies PincodeLookupResult);
    }
  });
}
