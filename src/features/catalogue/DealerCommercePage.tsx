import { useState } from "react";
import { DealerOrderJourney } from "../orders/DealerOrderJourney";
import { CataloguePage } from "./CataloguePage";
import type { CatalogueProduct } from "./types";

export function DealerCommercePage({ requestOrderOtp }: { requestOrderOtp: (purpose: "ORDER_SUBMISSION") => Promise<string> }) {
  const [selected, setSelected] = useState<CatalogueProduct | null>(null);
  return selected ? <DealerOrderJourney product={selected} requestOrderOtp={requestOrderOtp} onBack={() => setSelected(null)} /> : <CataloguePage onOpenProduct={setSelected} />;
}
