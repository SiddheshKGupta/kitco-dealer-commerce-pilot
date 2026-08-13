import { useEffect, useRef } from "react";
import { FilterRail } from "./FilterRail";

interface Props { open: boolean; brands: string[]; selected: string[]; onToggle: (brand: string) => void; onClose: () => void }

export function MobileFilterDrawer({ open, brands, selected, onToggle, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;
  useEffect(() => {
    if (!open) return;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeHandler.current(); return; }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button, input, select, [href], [tabindex]:not([tabindex='-1'])") ?? [])].filter((node) => !node.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0]; const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); returnFocus?.focus(); };
  }, [open]);
  if (!open) return null;
  return <div className="commerce-drawer-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="commerce-filter-drawer" role="dialog" aria-modal="true" aria-label="Product filters">
      <header><p>Refine products</p><button ref={closeRef} type="button" onClick={onClose} aria-label="Close filters">Close</button></header>
      <FilterRail brands={brands} selected={selected} onToggle={onToggle} className="is-mobile" />
      <button className="commerce-primary" type="button" onClick={onClose}>Show products</button>
    </section>
  </div>;
}
