import { describe, expect, it } from "vitest";
import {
  GST_STATE_CODES,
  gstinMatchesState,
  gstinStateCode,
  gstinStateName,
  isValidGstin,
  sameStateName,
} from "../../src/domain/gstin";

describe("isValidGstin", () => {
  it("accepts a structurally correct GSTIN", () => {
    expect(isValidGstin("22AAAAA0000A1Z5")).toBe(true);
    expect(isValidGstin("10ABCDE1234F1Z5")).toBe(true);
  });

  it("rejects the wrong length", () => {
    expect(isValidGstin("TOOSHORT")).toBe(false);
    expect(isValidGstin("22AAAAA0000A1Z5EXTRA")).toBe(false);
  });

  it("rejects 15 characters in the wrong shape -- the old bare-length check would have let this through", () => {
    // Digits where the 5-letter PAN block belongs.
    expect(isValidGstin("22123450000A1Z5")).toBe(false);
    // Missing the fixed literal "Z" in position 14.
    expect(isValidGstin("22AAAAA0000A1Y5")).toBe(false);
    // Entity code "0" is not in [1-9A-Z].
    expect(isValidGstin("22AAAAA0000A0Z5")).toBe(false);
  });

  it("rejects lowercase -- callers normalise before validating, this does not", () => {
    expect(isValidGstin("22aaaaa0000a1z5")).toBe(false);
  });
});

describe("GST_STATE_CODES", () => {
  it("covers every code 01-38, including the deprecated ones", () => {
    expect(Object.keys(GST_STATE_CODES)).toHaveLength(38);
    expect(GST_STATE_CODES["10"]).toBe("Bihar");
    expect(GST_STATE_CODES["25"]).toBe("Daman & Diu");
    expect(GST_STATE_CODES["28"]).toBe("Andhra Pradesh");
    expect(GST_STATE_CODES["37"]).toBe("Andhra Pradesh");
  });
});

describe("gstinStateCode / gstinStateName", () => {
  it("reads the state from a valid GSTIN", () => {
    expect(gstinStateCode("10ABCDE1234F1Z5")).toBe("10");
    expect(gstinStateName("10ABCDE1234F1Z5")).toBe("Bihar");
  });

  it("returns null for a structurally invalid GSTIN rather than guessing", () => {
    expect(gstinStateCode("NOTAGSTIN")).toBeNull();
    expect(gstinStateName("NOTAGSTIN")).toBeNull();
  });
});

describe("sameStateName", () => {
  it("matches regardless of case, spacing and & vs and", () => {
    expect(sameStateName("Bihar", "bihar")).toBe(true);
    expect(sameStateName("Jammu & Kashmir", "Jammu and Kashmir")).toBe(true);
    expect(sameStateName("West Bengal", "  west   bengal ")).toBe(true);
  });

  it("flags a genuine mismatch", () => {
    expect(sameStateName("Bihar", "Jharkhand")).toBe(false);
  });

  it("treats a blank side as unverifiable, not a mismatch -- fail open, never reject on what cannot be confirmed wrong", () => {
    expect(sameStateName("Bihar", "")).toBe(true);
    expect(sameStateName(null, "Bihar")).toBe(true);
    expect(sameStateName(undefined, undefined)).toBe(true);
  });
});

describe("gstinMatchesState", () => {
  it("matches a GSTIN's embedded state code against the dealer's state", () => {
    // 10 = Bihar
    expect(gstinMatchesState("10ABCDE1234F1Z5", "Bihar")).toBe(true);
    expect(gstinMatchesState("10ABCDE1234F1Z5", "bihar")).toBe(true);
  });

  it("flags a genuine state-code-vs-address mismatch", () => {
    // 22 = Chhattisgarh, not Bihar.
    expect(gstinMatchesState("22AAAAA0000A1Z5", "Bihar")).toBe(false);
  });

  it("does not reject when the GSTIN is invalid or the state is blank -- unverifiable, not a mismatch", () => {
    expect(gstinMatchesState("NOTAGSTIN", "Bihar")).toBe(true);
    expect(gstinMatchesState("10ABCDE1234F1Z5", "")).toBe(true);
    expect(gstinMatchesState("10ABCDE1234F1Z5", undefined)).toBe(true);
  });
});
