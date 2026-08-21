export type OfferingType = "STOCK_IN_HAND" | "UPCOMING" | "PREBOOK";

export interface CatalogueProduct {
  colourwayId: string;
  articleNo: string;
  brand: string;
  familyId?: string | null;
  familyName?: string | null;
  category?: string | null;
  gender?: string | null;
  colour: string;
  mrpMinor: number;
  currencyCode: string;
  mediaUrl: string | null;
  availability: "AVAILABLE_TO_ORDER" | "UNAVAILABLE";
  offering: {
    id: string;
    enabledSizes: string[];
    moqPairs: number;
    orderMultiplePairs: number;
    type?: OfferingType;
  };
}

export function formatRetailValue(minor: number, currencyCode = "INR") {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: currencyCode, minimumFractionDigits: 2 }).format(minor / 100);
}

function titleCase(value: string) {
  return value.split(" ").map((word) => word.charAt(0) + word.slice(1).toLowerCase()).join(" ");
}

/** "Men · Running" style copy for the card and PDP. Gender is never blank server-side
 *  (absent/unrecognised normalises to UNKNOWN); category can still be null. */
export function genderCategoryLabel(product: Pick<CatalogueProduct, "gender" | "category">) {
  const gender = titleCase(product.gender ?? "UNKNOWN");
  return product.category ? `${gender} · ${titleCase(product.category)}` : gender;
}
