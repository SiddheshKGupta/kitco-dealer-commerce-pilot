import type { CatalogueProduct } from "./types";

export class CatalogueRequestError extends Error {
  constructor(public readonly status: number) { super("Catalogue could not be loaded"); }
}

export async function fetchCatalogue(): Promise<CatalogueProduct[]> {
  const response = await fetch("/api/catalogue", { credentials: "include" });
  if (!response.ok) throw new CatalogueRequestError(response.status);
  const body = await response.json() as { items: CatalogueProduct[] };
  return Array.isArray(body.items) ? body.items : [];
}
