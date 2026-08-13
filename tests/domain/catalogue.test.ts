import {
  buildColourwayIdentity,
  buildFamilyIdentity,
  canOrderOffering,
  isConfiguredSize,
} from "../../src/domain/catalogue";

describe("catalogue domain rules", () => {
  it("creates stable family and colourway identities from normalized source values", () => {
    expect(buildFamilyIdentity(" nike ", "  io2091 ")).toBe("NIKE:IO2091");
    expect(buildColourwayIdentity("NIKE:IO2091", " io2091-103 ")).toBe(
      "NIKE:IO2091:IO2091-103",
    );
  });

  it("allows quantities only for configured enabled sizes", () => {
    const sizeSet = [
      { value: "7", enabled: true },
      { value: "8", enabled: false },
    ];

    expect(isConfiguredSize(sizeSet, "7")).toBe(true);
    expect(isConfiguredSize(sizeSet, "8")).toBe(false);
    expect(isConfiguredSize(sizeSet, "9")).toBe(false);
  });

  it("permits active offerings within their inclusive booking window only", () => {
    const offering = {
      active: true,
      bookingOpensOn: "2026-08-01",
      bookingClosesOn: "2026-08-31",
    };

    expect(canOrderOffering(offering, "2026-08-01")).toBe(true);
    expect(canOrderOffering(offering, "2026-08-31")).toBe(true);
    expect(canOrderOffering(offering, "2026-09-01")).toBe(false);
    expect(canOrderOffering({ ...offering, active: false }, "2026-08-15")).toBe(false);
  });
});
