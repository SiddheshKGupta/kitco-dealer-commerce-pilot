import { useEffect, useState } from "react";
import { DealerOrderJourney } from "../orders/DealerOrderJourney";
import { fetchCatalogue } from "./api";
import { CataloguePage } from "./CataloguePage";
import type { CatalogueProduct } from "./types";

export function DealerCommercePage() {
  const [selected, setSelected] = useState<CatalogueProduct | null>(null);
  const [colourways, setColourways] = useState<CatalogueProduct[]>([]);
  useEffect(() => {
    if (!selected?.familyId) { setColourways([]); return; }
    let current = true;
    void fetchCatalogue().then(
      (items) => { if (current) setColourways(items.filter((item) => item.familyId === selected.familyId)); },
      () => { if (current) setColourways([]); },
    );
    return () => { current = false; };
  }, [selected?.familyId]);

  if (!selected) return <CataloguePage onOpenProduct={setSelected} />;
  // key forces a remount on colourway switch -- the quantities/size selections a dealer
  // entered for one colourway must not silently carry over onto a different one.
  return <DealerOrderJourney key={selected.colourwayId} product={selected} colourways={colourways} onSelectColourway={setSelected} onBack={() => setSelected(null)} />;
}
