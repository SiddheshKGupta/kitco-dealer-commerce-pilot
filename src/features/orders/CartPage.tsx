import { useEffect, useState } from "react";
import { Button, EmptyState } from "../../components/ui";
import { formatSizeQuantities, sizeSystemDisplayLabel } from "../../domain/order-sizes";
import { formatRetailValue } from "../catalogue/types";
import { fetchDraft, mediaUrl, removeDraftLine, type DraftLine } from "./api";

function navigate(path: string) {
	window.history.pushState({}, "", path);
	window.dispatchEvent(new PopStateEvent("popstate"));
}

function pairs(quantities: Record<string, number>): number {
	return Object.values(quantities).reduce((sum, value) => sum + value, 0);
}

export function CartPage() {
	const [lines, setLines] = useState<DraftLine[] | null>(null);
	const [error, setError] = useState("");
	const [removingId, setRemovingId] = useState<string | null>(null);

	useEffect(() => {
		let active = true;
		fetchDraft().then((body) => { if (active) setLines(body.lines); }).catch(() => { if (active) setError("Current Order could not be loaded."); });
		return () => { active = false; };
	}, []);

	async function remove(offeringId: string) {
		setRemovingId(offeringId); setError("");
		try { setLines((await removeDraftLine(offeringId)).lines); }
		catch { setError("That article could not be removed. Try again."); }
		finally { setRemovingId(null); }
	}

	if (lines === null) {
		return <main className="commerce-page"><h1 className="sr-only">Current Order</h1><p role="status">Loading your current order…</p></main>;
	}

	if (lines.length === 0) {
		return <main className="commerce-page">
			<h1>Current Order</h1>
			<EmptyState title="Your Current Order is empty" description="Browse the catalogue and add articles to build your order." action={<Button onClick={() => navigate("/products")}>Browse Products</Button>} />
		</main>;
	}

	const totalPairs = lines.reduce((sum, line) => sum + pairs(line.quantities), 0);
	const totalValue = lines.reduce((sum, line) => sum + line.retailValueMinor, 0);
	const currencyCode = lines[0]?.currencyCode ?? "INR";

	return <main className="commerce-page cart-page">
		<h1>Current Order</h1>
		<div className="cart-lines">{lines.map((line) => {
			const image = mediaUrl(line.mediaKey);
			return <article className="cart-line" key={line.offeringId}>
				<div className="cart-line-media">{image
					? <img src={image} alt={`${line.articleNo} · ${line.colour}`} />
					: <div className="commerce-placeholder" role="img" aria-label={`Image unavailable for ${line.articleNo}`}><b>{line.articleNo}</b></div>}</div>
				<div className="cart-line-copy">
					<strong>{line.familyName ?? line.articleNo}</strong>
					<span>{[line.brand, line.familyName ? line.articleNo : null, line.colour].filter(Boolean).join(" · ")}</span>
					<span className="cart-line-size-system">Size system: {sizeSystemDisplayLabel(line.sizeSystemLabel)}</span>
					<span className="cart-line-sizes">{formatSizeQuantities(line.quantities)}</span>
					<span>{pairs(line.quantities)} pairs</span>
				</div>
				<div className="cart-line-value">
					<strong>{formatRetailValue(line.retailValueMinor, line.currencyCode)}</strong>
					<div className="cart-line-actions">
						<button type="button" className="text-action" onClick={() => navigate(`/products?open=${encodeURIComponent(line.offeringId)}`)}>Edit</button>
						<button type="button" className="text-action" disabled={removingId === line.offeringId} onClick={() => void remove(line.offeringId)}>{removingId === line.offeringId ? "Removing…" : "Remove"}</button>
					</div>
				</div>
			</article>;
		})}</div>
		{error && <p className="commerce-validation" role="alert"><span aria-hidden="true">✕</span> <span>{error}</span></p>}
		<section className="cart-summary">
			<div><span>{totalPairs} pairs · {lines.length} article{lines.length === 1 ? "" : "s"}</span><strong>{formatRetailValue(totalValue, currencyCode)}</strong></div>
			<Button full onClick={() => navigate("/checkout/review")}>Review Order</Button>
		</section>
	</main>;
}
