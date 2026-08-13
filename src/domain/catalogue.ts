export interface ConfiguredSize {
  value: string;
  enabled: boolean;
}

export interface CommercialOfferingWindow {
  active: boolean;
  bookingOpensOn: string;
  bookingClosesOn: string;
}

function normalizedIdentityPart(value: string): string {
  return value.trim().toUpperCase();
}

export function buildFamilyIdentity(brand: string, familyReference: string): string {
  return `${normalizedIdentityPart(brand)}:${normalizedIdentityPart(familyReference)}`;
}

export function buildColourwayIdentity(familyIdentity: string, articleNo: string): string {
  return `${normalizedIdentityPart(familyIdentity)}:${normalizedIdentityPart(articleNo)}`;
}

export function isConfiguredSize(sizes: readonly ConfiguredSize[], requestedSize: string): boolean {
  const normalizedSize = normalizedIdentityPart(requestedSize);
  return sizes.some((size) => size.enabled && normalizedIdentityPart(size.value) === normalizedSize);
}

export function canOrderOffering(offering: CommercialOfferingWindow, onDate: string): boolean {
  return offering.active && onDate >= offering.bookingOpensOn && onDate <= offering.bookingClosesOn;
}
