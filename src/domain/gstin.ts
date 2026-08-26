/** GSTIN structural validation and state cross-checks -- the single definition
 *  shared by registration, the dealer profile and the admin console, replacing
 *  three separate shape-only checks that had drifted (worker/routes/register.ts,
 *  worker/routes/dealer-profile.ts, worker/routes/admin-dealers.ts).
 *
 *  Deliberately stops short of the mod-36 checksum digit -- see
 *  docs/spec/V5_GST_INTEGRATION.md §6. A wrong checksum can still belong to a
 *  real, provider-issued GSTIN; rejecting on it locally would block a
 *  legitimate case the provider would accept. The regex below is a real
 *  structural upgrade over the previous bare 15-character check (state code,
 *  PAN shape, entity code, the fixed "Z"), just not the checksum itself.
 */

/** 2-digit state code + 10-char PAN (5 letters, 4 digits, 1 letter) + entity
 *  code (1-9 or A-Z) + literal "Z" + alphanumeric checksum character. */
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][Z][0-9A-Z]$/u;

export function isValidGstin(value: string): boolean {
  return GSTIN_REGEX.test(value);
}

/** Official CBIC GST state code table. Deprecated codes (25, 28) are kept --
 *  not scrubbed -- because they can still appear on older GSTINs that are
 *  otherwise perfectly valid; dropping them would fail a real dealer. */
export const GST_STATE_CODES: Readonly<Record<string, string>> = {
  "01": "Jammu & Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "25": "Daman & Diu", // deprecated, may appear on older GSTINs
  "26": "Dadra & Nagar Haveli and Daman & Diu", // current merged UT
  "27": "Maharashtra",
  "28": "Andhra Pradesh", // pre-2014, deprecated
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman & Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
};

/** First two digits, only once the GSTIN is structurally valid -- an invalid
 *  GSTIN has no reliable state code to read. */
export function gstinStateCode(gstin: string): string | null {
  return isValidGstin(gstin) ? gstin.slice(0, 2) : null;
}

export function gstinStateName(gstin: string): string | null {
  const code = gstinStateCode(gstin);
  return code ? GST_STATE_CODES[code] ?? null : null;
}

/** "Jammu & Kashmir" and "Jammu and Kashmir" are the same state; compare on
 *  that basis rather than demanding an exact ampersand match. */
function normaliseStateName(value: string): string {
  return value.trim().toLowerCase().replace(/&/g, "and").replace(/\s+/g, " ");
}

/** True when two state names refer to the same state -- and also true when
 *  either side is blank, since an unverifiable comparison is not a mismatch.
 *  Used to compare a PIN lookup's state against both the typed State field
 *  and the GSTIN's embedded state code (the PIN result is the source of
 *  truth for both -- see docs/spec/V5_GST_INTEGRATION.md and the pincode
 *  autocomplete wiring in RegisterPage/ProfilePage). */
export function sameStateName(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b || !a.trim() || !b.trim()) return true;
  return normaliseStateName(a) === normaliseStateName(b);
}

/** True when the GSTIN's embedded state code names the same state as
 *  `stateName` -- and also true when either side is unknown or blank, since
 *  an unverifiable comparison is not a mismatch (the same principle as the
 *  checksum decision above: never reject on something that cannot be
 *  confirmed wrong). */
export function gstinMatchesState(gstin: string, stateName: string | null | undefined): boolean {
  return sameStateName(gstinStateName(gstin), stateName);
}
