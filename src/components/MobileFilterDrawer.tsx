import { useEffect, useRef } from "react";
import { FilterRail } from "./FilterRail";

interface Props { open: boolean; brands: string[]; selected: string[]; onToggle: (brand: string) => void; onClose: () => void }

export function MobileFilterDrawer({ open, brands, selected, onToggle, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) closeRef.current?.focus(); }, [open]);
  if (!open) return null;
  return <div className="commerce-drawer-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="commerce-filter-drawer" role="dialog" aria-modal="true" aria-label="Product filters">
      <header><p>Refine products</p><button ref={closeRef} type="button" onClick={onClose} aria-label="Close filters">Close</button></header>
      <FilterRail brands={brands} selected={selected} onToggle={onToggle} className="is-mobile" />
      <button className="commerce-primary" type="button" onClick={onClose}>Show products</button>
    </section>
  </div>;
}
