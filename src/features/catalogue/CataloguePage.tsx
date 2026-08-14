import { useCallback, useEffect, useMemo, useState } from "react";
import { SearchField, Select, Tabs } from "../../components/ui";
import { FilterRail, type MrpRange, type MrpSelection } from "../../components/FilterRail";
import { MobileFilterDrawer } from "../../components/MobileFilterDrawer";
import { ProductGrid } from "../../components/ProductGrid";
import { CatalogueRequestError, fetchCatalogue } from "./api";
import type { CatalogueProduct, OfferingType } from "./types";
import "./commerce.css";

type Tab = "PRODUCTS" | "STOCK" | "UPCOMING" | "PREBOOK";
const tabs: Array<{ id: Tab; label: string; type?: OfferingType }> = [
  { id: "PRODUCTS", label: "Products" }, { id: "STOCK", label: "Stock in Hand", type: "STOCK_IN_HAND" }, { id: "UPCOMING", label: "Upcoming", type: "UPCOMING" }, { id: "PREBOOK", label: "Prebook", type: "PREBOOK" },
];

// Colour is deliberately not a filter group: 396 distinct values across 641 colourways
// makes a checkbox list unusable. Search already matches colour text instead.
type Dimension = "brand" | "category" | "gender" | "size";
const dimensionLabels: Record<Dimension, string> = { brand: "Brand", category: "Category", gender: "Gender", size: "Size" };
function valuesFor(product: CatalogueProduct, dimension: Dimension): string[] {
  if (dimension === "brand") return [product.brand];
  if (dimension === "category") return product.category ? [product.category] : [];
  if (dimension === "gender") return product.gender ? [product.gender] : [];
  return product.offering.enabledSizes;
}
const emptySelection: Record<string, string[]> = {};

export function CataloguePage({ onOpenProduct }: { onOpenProduct: (product: CatalogueProduct) => void }) {
  const [products, setProducts] = useState<CatalogueProduct[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "unauthenticated">("loading");
  const [tab, setTab] = useState<Tab>("PRODUCTS");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Record<string, string[]>>(emptySelection);
  const [mrpSelected, setMrpSelected] = useState<MrpSelection>({ min: null, max: null });
  const [sort, setSort] = useState("featured");
  const [drawer, setDrawer] = useState(false);
  const load = useCallback(() => {
    setStatus("loading");
    void fetchCatalogue().then((items) => { setProducts(items); setStatus("ready"); }, (error: unknown) => setStatus(error instanceof CatalogueRequestError && error.status === 401 ? "unauthenticated" : "error"));
  }, []);
  useEffect(load, [load]);

  const groups = useMemo(() => (["brand", "category", "gender", "size"] as Dimension[]).map((key) => ({
    key,
    label: dimensionLabels[key],
    options: [...new Set(products.flatMap((product) => valuesFor(product, key)))].sort((a, b) => {
      if (key !== "size") return a.localeCompare(b);
      const numA = Number.parseFloat(a); const numB = Number.parseFloat(b);
      if (Number.isNaN(numA) && Number.isNaN(numB)) return a.localeCompare(b);
      if (Number.isNaN(numA)) return 1;
      if (Number.isNaN(numB)) return -1;
      return numA - numB;
    }),
  })), [products]);
  const mrpBounds: MrpRange | null = useMemo(() => products.length === 0 ? null : {
    min: Math.min(...products.map((product) => product.mrpMinor)),
    max: Math.max(...products.map((product) => product.mrpMinor)),
  }, [products]);
  const totalSelected = useMemo(() => Object.values(selected).reduce((sum, values) => sum + values.length, 0) + (mrpSelected.min !== null || mrpSelected.max !== null ? 1 : 0), [selected, mrpSelected]);
  const hasActiveQuery = search.trim() !== "" || totalSelected > 0;

  const visible = useMemo(() => {
    const selectedTab = tabs.find((item) => item.id === tab);
    const query = search.trim().toLowerCase();
    const filtered = products.filter((product) =>
      (!selectedTab?.type || product.offering.type === selectedTab.type) &&
      (!query || `${product.articleNo} ${product.brand} ${product.colour} ${product.familyName ?? ""} ${product.category ?? ""}`.toLowerCase().includes(query)) &&
      (mrpSelected.min === null || product.mrpMinor >= mrpSelected.min) &&
      (mrpSelected.max === null || product.mrpMinor <= mrpSelected.max) &&
      (["brand", "category", "gender", "size"] as Dimension[]).every((dimension) => {
        const active = selected[dimension] ?? [];
        return active.length === 0 || valuesFor(product, dimension).some((value) => active.includes(value));
      }));
    return [...filtered].sort((a, b) => sort === "price-low" ? a.mrpMinor - b.mrpMinor : sort === "price-high" ? b.mrpMinor - a.mrpMinor : a.articleNo.localeCompare(b.articleNo));
  }, [selected, mrpSelected, products, search, sort, tab]);

  const toggleFilter = (dimension: string, value: string) => setSelected((current) => {
    const active = current[dimension] ?? [];
    const next = active.includes(value) ? active.filter((item) => item !== value) : [...active, value];
    return { ...current, [dimension]: next };
  });
  const clearFilters = () => { setSelected(emptySelection); setMrpSelected({ min: null, max: null }); };
  const clearAll = () => { setSearch(""); clearFilters(); };
  return <main className="commerce-page" aria-busy={status === "loading"}>
    <h1 className="sr-only">Products</h1>
    <Tabs items={tabs.map(({ id, label }) => ({ id, label }))} activeId={tab} onChange={(id) => setTab(id as Tab)} label="Catalogue sections" />
    <div className="commerce-toolbar">
      <SearchField label="Search products" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Product, article, brand or colour" />
      <button className="commerce-filter-trigger" type="button" onClick={() => setDrawer(true)}>Filters{totalSelected > 0 ? ` (${totalSelected})` : ""}</button>
      <label className="commerce-sort"><span>Sort</span><Select value={sort} onChange={(event) => setSort(event.target.value)}><option value="featured">Featured</option><option value="price-low">MRP: Low to high</option><option value="price-high">MRP: High to low</option></Select></label>
    </div>
    {status === "loading" ? <p className="commerce-status" role="status">Loading products…</p> : status === "unauthenticated" ? <div className="commerce-status" role="alert"><strong>Your session has ended.</strong><a className="ui-btn ui-btn-primary ui-btn-md" href="/login?returnTo=/products">Sign in again</a></div> : status === "error" ? <div className="commerce-status" role="alert"><strong>Products could not be loaded.</strong><button className="ui-btn ui-btn-primary ui-btn-md" type="button" onClick={load}>Try again</button></div> : <div className="commerce-results"><FilterRail groups={groups} selected={selected} onToggle={toggleFilter} mrpBounds={mrpBounds} mrpSelected={mrpSelected} onMrpChange={setMrpSelected} onClearAll={clearFilters} totalSelected={totalSelected} /><section aria-label="Products"><div className="commerce-result-count">{visible.length} colourways</div><ProductGrid products={visible} onOpenProduct={onOpenProduct} onClearFilters={hasActiveQuery ? clearAll : undefined} /></section></div>}
    <MobileFilterDrawer open={drawer} groups={groups} selected={selected} onToggle={toggleFilter} mrpBounds={mrpBounds} mrpSelected={mrpSelected} onMrpChange={setMrpSelected} onClearAll={clearFilters} totalSelected={totalSelected} onClose={() => setDrawer(false)} />
  </main>;
}
