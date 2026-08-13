import type { CatalogueProduct } from "./types";

export async function fetchCatalogue(): Promise<CatalogueProduct[]> {
  const response = await fetch("/api/catalogue", { credentials: "include" });
  if (!response.ok) throw new Error("Catalogue could not be loaded");
  const body = await response.json() as { items: CatalogueProduct[] };
  return Array.isArray(body.items) ? body.items : [];
}
