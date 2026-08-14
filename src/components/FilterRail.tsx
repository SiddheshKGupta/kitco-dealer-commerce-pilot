export interface FilterGroup { key: string; label: string; options: string[] }
export interface MrpRange { min: number; max: number }
export interface MrpSelection { min: number | null; max: number | null }

interface FilterRailProps {
  groups: FilterGroup[];
  selected: Record<string, string[]>;
  onToggle: (groupKey: string, value: string) => void;
  mrpBounds: MrpRange | null;
  mrpSelected: MrpSelection;
  onMrpChange: (selection: MrpSelection) => void;
  onClearAll: () => void;
  totalSelected: number;
  className?: string;
}

export function FilterRail({ groups, selected, onToggle, mrpBounds, mrpSelected, onMrpChange, onClearAll, totalSelected, className = "" }: FilterRailProps) {
  return <aside className={`commerce-filter-rail ${className}`} aria-label="Product filters">
    <div className="commerce-filter-heading">
      <strong>Filter</strong>
      {totalSelected > 0 ? <button type="button" className="commerce-filter-clear" onClick={onClearAll}>Clear all ({totalSelected})</button> : <span>All</span>}
    </div>
    {groups.map((group) => group.options.length > 0 && <details key={group.key} className="commerce-filter-group" open={(selected[group.key] ?? []).length > 0}>
      <summary>{group.label}</summary>
      <fieldset>
        {group.options.map((option) => <label key={option}>
          <input type="checkbox" checked={(selected[group.key] ?? []).includes(option)} onChange={() => onToggle(group.key, option)} />
          <span>{option}</span>
        </label>)}
      </fieldset>
    </details>)}
    {mrpBounds && mrpBounds.min < mrpBounds.max && <details className="commerce-filter-group" open={mrpSelected.min !== null || mrpSelected.max !== null}>
      <summary>MRP</summary>
      <div className="commerce-filter-range-inputs">
        <label>Min<input type="number" inputMode="numeric" min={mrpBounds.min} max={mrpBounds.max} placeholder={String(mrpBounds.min)} value={mrpSelected.min ?? ""} onChange={(event) => onMrpChange({ min: event.target.value ? Number(event.target.value) : null, max: mrpSelected.max })} /></label>
        <label>Max<input type="number" inputMode="numeric" min={mrpBounds.min} max={mrpBounds.max} placeholder={String(mrpBounds.max)} value={mrpSelected.max ?? ""} onChange={(event) => onMrpChange({ min: mrpSelected.min, max: event.target.value ? Number(event.target.value) : null })} /></label>
      </div>
    </details>}
  </aside>;
}
