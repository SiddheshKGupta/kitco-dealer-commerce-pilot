interface FilterRailProps { brands: string[]; selected: string[]; onToggle: (brand: string) => void; className?: string }

export function FilterRail({ brands, selected, onToggle, className = "" }: FilterRailProps) {
  return <aside className={`commerce-filter-rail ${className}`} aria-label="Product filters">
    <div className="commerce-filter-heading"><strong>Filter</strong><span>{selected.length || "All"}</span></div>
    <fieldset><legend>Brand</legend>{brands.map((brand) => <label key={brand}>
      <input type="checkbox" checked={selected.includes(brand)} onChange={() => onToggle(brand)} />
      <span>{brand}</span>
    </label>)}</fieldset>
  </aside>;
}
