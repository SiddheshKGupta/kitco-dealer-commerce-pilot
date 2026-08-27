import { useMemo, useState } from "react";
import { Button } from "../../components/ui";
import { SizeChartSheet } from "../../components/SizeChartSheet";
import { SizeGrid } from "../../components/SizeGrid";
import type { CatalogueProduct } from "../catalogue/types";
import { formatRetailValue, genderCategoryLabel } from "../catalogue/types";
import { saveDraft } from "./api";

function navigate(path: string) {
	window.history.pushState({}, "", path);
	window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Article selection only -- adds to the shared Current Order and stops there.
 *  No OTP, no ship-to, no submit here: that's the review screen (Slice 6),
 *  reached once via Cart, after every article the dealer wants is added. */
export function DealerOrderJourney({ product, colourways = [], onSelectColourway, onBack }: {
	product: CatalogueProduct; colourways?: CatalogueProduct[]; onSelectColourway?: (product: CatalogueProduct) => void; onBack?: () => void;
}) {
	const [quantities, setQuantities] = useState<Record<string, number>>({});
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState("");
	const [pending, setPending] = useState(false);
	const [showSizeChart, setShowSizeChart] = useState(false);
	const totalPairs = Object.values(quantities).reduce((sum, pairs) => sum + pairs, 0);
	const validation = useMemo(() => totalPairs > 0 && totalPairs < product.offering.moqPairs
		? `Add ${product.offering.moqPairs - totalPairs} more pairs to meet the ${product.offering.moqPairs}-pair minimum.`
		: totalPairs > 0 && totalPairs % product.offering.orderMultiplePairs !== 0 ? `Order in multiples of ${product.offering.orderMultiplePairs} pairs.` : "", [product, totalPairs]);
	const add = async () => {
		if (totalPairs === 0 || validation) return;
		setError(""); setPending(true);
		try {
			await saveDraft(product.offering.id, Object.fromEntries(Object.entries(quantities).filter(([, pairs]) => pairs > 0)));
			setSaved(true);
		} catch (caught) { setError(caught instanceof Error ? caught.message : "Current Order could not be saved"); }
		finally { setPending(false); }
	};
	return <main className="commerce-page commerce-pdp">
		{onBack && <Button variant="secondary" className="commerce-back" onClick={onBack}>← All products</Button>}
		<div className="commerce-pdp-grid"><div className="commerce-pdp-media">{product.mediaUrl ? <img src={product.mediaUrl} alt={`${product.articleNo} · ${product.colour}`} /> : <div className="commerce-placeholder" role="img" aria-label={`Image unavailable for ${product.articleNo}`}><b>{product.articleNo}</b><small>Image arriving soon</small></div>}</div>
			<section className="commerce-pdp-copy"><p className="commerce-eyebrow">{product.brand} · Exact colourway</p><h1>{product.familyName ?? product.articleNo}</h1><p className="commerce-colour">{product.colour}{product.familyName ? ` · Article ${product.articleNo}` : ""}</p><p className="commerce-colour">{genderCategoryLabel(product)}</p>
				{colourways.length > 1 && <div className="commerce-colourway-switcher" role="group" aria-label="Other colours">{colourways.map((option) => <button key={option.colourwayId} type="button" className="commerce-colourway-swatch" aria-current={option.colourwayId === product.colourwayId} title={option.colour} onClick={() => { if (option.colourwayId !== product.colourwayId) onSelectColourway?.(option); }}>
					{option.mediaUrl ? <img src={option.mediaUrl} alt={option.colour} /> : <span>{option.colour}</span>}
				</button>)}</div>}
				<p className="commerce-mrp">MRP {formatRetailValue(product.mrpMinor, product.currencyCode)}</p><div className="commerce-policy"><span>Minimum {product.offering.moqPairs} pairs</span><span>Multiple of {product.offering.orderMultiplePairs}</span></div>
				<Button variant="ghost" size="md" onClick={() => setShowSizeChart(true)}>Not sure of your size? See the size chart</Button>
				<SizeGrid sizes={product.offering.enabledSizes} quantities={quantities} onChange={(size, pairs) => { setQuantities((current) => ({ ...current, [size]: pairs })); setSaved(false); }} />
				{validation && <p className="commerce-validation" role="alert"><span aria-hidden="true">✕</span> <span>{validation}</span></p>}
				<SizeChartSheet open={showSizeChart} onClose={() => setShowSizeChart(false)} />
				<section className="commerce-order-tray" aria-label="Current Order action">
					{saved ? <>
						<div><span>Saved to Current Order</span><strong>{totalPairs} pairs</strong></div>
						<div className="commerce-order-tray-actions">
							<Button variant="secondary" onClick={() => (onBack ? onBack() : navigate("/products"))}>Continue Shopping</Button>
							<Button onClick={() => navigate("/cart")}>View Cart</Button>
						</div>
					</> : <>
						<div><span>{totalPairs} pairs selected</span><strong>Retail Value calculated by KITCO</strong></div>
						<Button full disabled={totalPairs === 0 || Boolean(validation) || pending} onClick={() => void add()}>{pending ? "Saving…" : "Add to Current Order"}</Button>
					</>}
				</section>
				{error && <p className="commerce-validation" role="alert"><span aria-hidden="true">✕</span> <span>{error}</span></p>}
			</section></div>
	</main>;
}
