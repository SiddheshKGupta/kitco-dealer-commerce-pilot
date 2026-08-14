import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { FilterRail } from "../../components/FilterRail";
import { MobileFilterDrawer } from "../../components/MobileFilterDrawer";
import { ProductGrid } from "../../components/ProductGrid";
import { CatalogueRequestError, fetchCatalogue } from "./api";
import type { CatalogueProduct, OfferingType } from "./types";
import "./commerce.css";

type Tab = "PRODUCTS" | "STOCK" | "UPCOMING" | "PREBOOK";
const tabs: Array<{ id: Tab; label: string; type?: OfferingType }> = [
  { id: "PRODUCTS", label: "Products" }, { id: "STOCK", label: "Stock in Hand", type: "STOCK_IN_HAND" }, { id: "UPCOMING", label: "Upcoming", type: "UPCOMING" }, { id: "PREBOOK", label: "Prebook", type: "PREBOOK" },
];

export function CataloguePage({ onOpenProduct }: { onOpenProduct: (product: CatalogueProduct) => void }) {
  const [products, setProducts] = useState<CatalogueProduct[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "unauthenticated">("loading");
  const [tab, setTab] = useState<Tab>("PRODUCTS");
  const [search, setSearch] = useState("");
  const [brands, setBrands] = useState<string[]>([]);
  const [sort, setSort] = useState("featured");
  const [drawer, setDrawer] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const load = useCallback(() => {
    setStatus("loading");
    void fetchCatalogue().then((items) => { setProducts(items); setStatus("ready"); }, (error: unknown) => setStatus(error instanceof CatalogueRequestError && error.status === 401 ? "unauthenticated" : "error"));
  }, []);
  useEffect(load, [load]);
  const allBrands = useMemo(() => [...new Set(products.map((product) => product.brand))].sort(), [products]);
  const visible = useMemo(() => {
    const selectedTab = tabs.find((item) => item.id === tab);
    const query = search.trim().toLowerCase();
    const filtered = products.filter((product) =>
      (!selectedTab?.type || product.offering.type === selectedTab.type) &&
      (brands.length === 0 || brands.includes(product.brand)) &&
      (!query || `${product.articleNo} ${product.brand} ${product.colour}`.toLowerCase().includes(query)));
    return [...filtered].sort((a, b) => sort === "price-low" ? a.mrpMinor - b.mrpMinor : sort === "price-high" ? b.mrpMinor - a.mrpMinor : a.articleNo.localeCompare(b.articleNo));
  }, [brands, products, search, sort, tab]);
  const toggleBrand = (brand: string) => setBrands((current) => current.includes(brand) ? current.filter((item) => item !== brand) : [...current, brand]);
  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : -1;
    if (target < 0) return;
    event.preventDefault();
    setTab(tabs[target].id);
    tabRefs.current[target]?.focus();
  };
  return <main className="commerce-page" aria-busy={status === "loading"}>
    <header className="commerce-page-heading"><div><p className="commerce-eyebrow">Dealer catalogue · Exact colourways</p><h1>Products</h1></div><div><p>Browse your next collection.</p><p>See retail value, choose pairs by size, and build one Current Order.</p></div></header>
    <nav className="commerce-tabs" role="tablist" aria-label="Catalogue sections">{tabs.map((item, index) => <button key={item.id} ref={(node) => { tabRefs.current[index] = node; }} role="tab" aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} type="button" onKeyDown={(event) => handleTabKey(event, index)} onClick={() => setTab(item.id)}>{item.label}</button>)}</nav>
    <div className="commerce-toolbar">
      <label className="commerce-search"><span>Search</span><input type="search" aria-label="Search products" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Article, brand or colour" /></label>
      <button className="commerce-filter-trigger" type="button" onClick={() => setDrawer(true)}>Filters</button>
      <label className="commerce-sort"><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="featured">Featured</option><option value="price-low">MRP: Low to high</option><option value="price-high">MRP: High to low</option></select></label>
    </div>
    {status === "loading" ? <p className="commerce-status" role="status">Loading products…</p> : status === "unauthenticated" ? <div className="commerce-status" role="alert"><strong>Your session has ended.</strong><a className="commerce-primary" href="/login?returnTo=/products">Sign in again</a></div> : status === "error" ? <div className="commerce-status" role="alert"><strong>Products could not be loaded.</strong><button className="commerce-primary" type="button" onClick={load}>Try again</button></div> : <div className="commerce-results"><FilterRail brands={allBrands} selected={brands} onToggle={toggleBrand} /><section aria-label="Products"><div className="commerce-result-count">{visible.length} colourways</div><ProductGrid products={visible} onOpenProduct={onOpenProduct} /></section></div>}
    <MobileFilterDrawer open={drawer} brands={allBrands} selected={brands} onToggle={toggleBrand} onClose={() => setDrawer(false)} />
  </main>;
}
