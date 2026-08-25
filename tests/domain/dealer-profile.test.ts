import { describe, expect, it } from "vitest";
import {
  describeMissingProfileFields,
  isProfileComplete,
  missingProfileFields,
  REQUIRED_PROFILE_FIELDS,
  type DealerProfile,
} from "../../src/domain/dealer-profile";

const complete: DealerProfile = {
  gstin: "22AAAAA0000A1Z5",
  addressLine1: "12 MG Road",
  city: "Patna",
  state: "Bihar",
  pinCode: "800001",
  contactPerson: "Asha Rao",
  mobile: "9800000000",
};

describe("dealer profile completeness", () => {
  it("passes a fully filled profile", () => {
    expect(missingProfileFields(complete)).toEqual([]);
    expect(isProfileComplete(complete)).toBe(true);
    expect(describeMissingProfileFields(complete)).toBe("");
  });

  it("does not gate on secondary email or storefront photo", () => {
    expect(isProfileComplete({ ...complete, secondaryEmail: null, storefrontPhotoKey: null })).toBe(true);
    expect(REQUIRED_PROFILE_FIELDS).not.toContain("secondaryEmail" as never);
    expect(REQUIRED_PROFILE_FIELDS).not.toContain("storefrontPhotoKey" as never);
  });

  it("does not gate on address line 2, which many shops genuinely lack", () => {
    expect(isProfileComplete({ ...complete, addressLine2: null })).toBe(true);
  });

  it("treats whitespace-only values as missing", () => {
    expect(missingProfileFields({ ...complete, contactPerson: "   " })).toEqual(["contactPerson"]);
    expect(missingProfileFields({ ...complete, gstin: "" })).toEqual(["gstin"]);
  });

  it("treats null and undefined as missing", () => {
    expect(missingProfileFields({ ...complete, mobile: null })).toEqual(["mobile"]);
    expect(missingProfileFields({ ...complete, pinCode: undefined })).toEqual(["pinCode"]);
  });

  it("reports every missing field in form order, not discovery order", () => {
    expect(missingProfileFields({})).toEqual([
      "gstin", "addressLine1", "city", "state", "pinCode", "contactPerson", "mobile",
    ]);
  });

  it("describes the gap in plain language for a single-sentence block message", () => {
    expect(describeMissingProfileFields({ ...complete, gstin: null })).toBe("GST number");
    expect(describeMissingProfileFields({ ...complete, gstin: null, mobile: null }))
      .toBe("GST number and mobile number");
    expect(describeMissingProfileFields({ ...complete, gstin: null, pinCode: null, mobile: null }))
      .toBe("GST number, PIN code and mobile number");
  });
});
