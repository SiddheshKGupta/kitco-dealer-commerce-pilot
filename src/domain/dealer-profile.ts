/** Dealer profile completeness — the single definition of "may this dealer order?".
 *
 *  Deliberately one module shared by the worker's order gate and the dealer's
 *  profile screen. If the UI computed this separately it would eventually drift
 *  from the rule that actually blocks the order, and the dealer would see a
 *  green profile and a refused checkout with no way to reconcile the two.
 *
 *  The gate is enforced server-side in POST /api/orders/submit. The UI uses the
 *  same function only to explain the block early -- a disabled button is a
 *  courtesy, never the control.
 */

export interface DealerProfile {
  /** Resolved through gst_registration_id -> gst_registrations.gstin. */
  gstin?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  pinCode?: string | null;
  mobile?: string | null;
  contactPerson?: string | null;
  /** Prompted but never gated -- see REQUIRED_PROFILE_FIELDS. */
  secondaryEmail?: string | null;
  /** Optional storefront (shop facade) photo. Never gated. */
  storefrontPhotoKey?: string | null;
}

export type RequiredProfileField =
  | "gstin"
  | "addressLine1"
  | "city"
  | "state"
  | "pinCode"
  | "mobile"
  | "contactPerson";

/** Ordered so "what's missing" reads the way the form is laid out. */
export const REQUIRED_PROFILE_FIELDS: readonly RequiredProfileField[] = [
  "gstin",
  "addressLine1",
  "city",
  "state",
  "pinCode",
  "contactPerson",
  "mobile",
] as const;

/** Plain-language labels. The dealer audience is 40-50 and on a phone in a shop,
 *  so these are the words on the form, not the column names. */
export const PROFILE_FIELD_LABELS: Record<RequiredProfileField, string> = {
  gstin: "GST number",
  addressLine1: "Shop address",
  city: "City",
  state: "State",
  pinCode: "PIN code",
  contactPerson: "Contact person",
  mobile: "Mobile number",
};

function filled(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** Which required fields are still blank, in form order. */
export function missingProfileFields(profile: DealerProfile): RequiredProfileField[] {
  return REQUIRED_PROFILE_FIELDS.filter((field) => !filled(profile[field]));
}

export function isProfileComplete(profile: DealerProfile): boolean {
  return missingProfileFields(profile).length === 0;
}

/** Labels are written for a form ("Mobile number"), but the block message reads
 *  them mid-sentence ("Add GST number and mobile number..."), where a stray
 *  capital looks like a mistake. Lowercase the first word only when it is an
 *  ordinary word -- "GST" and "PIN" are acronyms and must survive intact. */
function midSentence(label: string): string {
  const startsWithAcronym = /^[A-Z]{2,}/u.test(label);
  return startsWithAcronym ? label : label.charAt(0).toLowerCase() + label.slice(1);
}

/** "GST number, PIN code and mobile number" -- for a single-sentence explanation
 *  of why checkout is blocked. */
export function describeMissingProfileFields(profile: DealerProfile): string {
  const labels = missingProfileFields(profile).map((field) => midSentence(PROFILE_FIELD_LABELS[field]));
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}
