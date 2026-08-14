import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Checkbox, OTPInput } from "../../components/ui";
import { formatRetailValue } from "../catalogue/types";
import { fetchDealerLocations, fetchDraft, mediaUrl, submitOrder, type DealerLocation, type DraftLine } from "./api";

type Stage = "review" | "otp" | "submitted";

function pairs(quantities: Record<string, number>): number {
	return Object.values(quantities).reduce((sum, value) => sum + value, 0);
}

function sizesLabel(quantities: Record<string, number>): string {
	return Object.entries(quantities).filter(([, value]) => value > 0).map(([size, value]) => `${size}×${value}`).join("  ");
}

/** One OTP for the whole order, issued only here after every article has been
 *  reviewed -- never per article, never on the cart or product page (v4.0 §23/§48). */
export function ReviewPage({ requestOrderOtp }: { requestOrderOtp: (purpose: "ORDER_SUBMISSION") => Promise<string> }) {
	const [lines, setLines] = useState<DraftLine[] | null>(null);
	const [locations, setLocations] = useState<DealerLocation[]>([]);
	const [locationsStatus, setLocationsStatus] = useState<"loading" | "ready" | "error">("loading");
	const [location, setLocation] = useState("");
	const [confirmed, setConfirmed] = useState(false);
	const [stage, setStage] = useState<Stage>("review");
	const [challengeId, setChallengeId] = useState("");
	const [otp, setOtp] = useState("");
	const [version, setVersion] = useState<number | null>(null);
	const [error, setError] = useState("");
	const [pending, setPending] = useState<"otp" | "submit" | null>(null);
	const idempotencyKey = useRef<string | null>(null);

	useEffect(() => {
		let active = true;
		fetchDraft().then((body) => { if (active) setLines(body.lines); }).catch(() => { if (active) setError("Current Order could not be loaded."); });
		void fetchDealerLocations().then((items) => { if (active) { setLocations((items ?? []).filter((item) => item.locationType !== "BILL_TO")); setLocationsStatus("ready"); } }, () => { if (active) setLocationsStatus("error"); });
		return () => { active = false; };
	}, []);

	const totalPairs = useMemo(() => (lines ?? []).reduce((sum, line) => sum + pairs(line.quantities), 0), [lines]);
	const totalValue = useMemo(() => (lines ?? []).reduce((sum, line) => sum + line.retailValueMinor, 0), [lines]);
	const currencyCode = lines?.[0]?.currencyCode ?? "INR";

	async function issueOtp() {
		setError(""); setPending("otp");
		try { setChallengeId(await requestOrderOtp("ORDER_SUBMISSION")); setStage("otp"); }
		catch (caught) { setError(caught instanceof Error ? caught.message : "The order code could not be sent. Try again."); }
		finally { setPending(null); }
	}
	async function submit() {
		if (otp.length !== 6 || !challengeId) return;
		setError(""); setPending("submit");
		idempotencyKey.current ??= crypto.randomUUID();
		try {
			const result = await submitOrder({ otpChallengeId: challengeId, otpCode: otp, idempotencyKey: idempotencyKey.current });
			setVersion(result.order.version); setStage("submitted");
		} catch (caught) { setError(caught instanceof Error ? caught.message : "Order could not be submitted"); }
		finally { setPending(null); }
	}

	if (lines === null) return <main className="commerce-page"><h1 className="sr-only">Review Order</h1><p role="status">Loading your order…</p></main>;

	if (stage === "submitted") {
		return <main className="commerce-page">
			<section className="commerce-submitted"><span aria-hidden="true">✓</span><div>
				<strong>Order submitted{version ? ` · Version ${version}` : ""}</strong>
				<p>KITCO has received your order and will confirm approved and held quantities shortly.</p>
				<a className="ui-btn ui-btn-primary ui-btn-md" href="/orders">Track your order</a>
			</div></section>
		</main>;
	}

	if (lines.length === 0) {
		return <main className="commerce-page"><h1>Review Order</h1><p className="field-note">Your Current Order is empty. <a href="/products">Browse products</a> to add articles.</p></main>;
	}

	return <main className="commerce-page commerce-review-page">
		<h1>Review Order</h1>

		<section className="commerce-review-section">
			<h2>Delivery to</h2>
			<label>Ship-to location
				<select aria-label="Ship-to location" value={location} disabled={locationsStatus !== "ready" || locations.length === 0} onChange={(event) => setLocation(event.target.value)}>
					<option value="">{locationsStatus === "loading" ? "Loading locations…" : locations.length === 0 ? "No ship-to locations available" : "Choose location"}</option>
					{locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
				</select>
			</label>
			{locationsStatus === "error" && <p className="commerce-validation" role="alert">Ship-to locations could not be loaded. Try again shortly.</p>}
		</section>

		<section className="commerce-review-section">
			<h2>Order items</h2>
			<div className="cart-lines">{lines.map((line) => {
				const image = mediaUrl(line.mediaKey);
				return <article className="cart-line" key={line.offeringId}>
					<div className="cart-line-media">{image
						? <img src={image} alt={`${line.articleNo} · ${line.colour}`} />
						: <div className="commerce-placeholder" role="img" aria-label={`Image unavailable for ${line.articleNo}`}><b>{line.articleNo}</b></div>}</div>
					<div className="cart-line-copy">
						<strong>{line.familyName ?? line.articleNo}</strong>
						<span>{[line.brand, line.familyName ? line.articleNo : null, line.colour].filter(Boolean).join(" · ")}</span>
						<span className="cart-line-sizes">{sizesLabel(line.quantities)}</span>
						<span>{pairs(line.quantities)} pairs</span>
					</div>
					<div className="cart-line-value"><strong>{formatRetailValue(line.retailValueMinor, line.currencyCode)}</strong></div>
				</article>;
			})}</div>
		</section>

		<section className="commerce-review-section commerce-review-summary">
			<div><span>Articles</span><strong>{lines.length}</strong></div>
			<div><span>Pairs</span><strong>{totalPairs}</strong></div>
			<div><span>Retail Value</span><strong>{formatRetailValue(totalValue, currencyCode)}</strong></div>
			<p className="field-note">Retail Value is based on MRP. Dealer commercial terms, GST and final billing remain outside this portal unless separately confirmed by KITCO.</p>
		</section>

		{stage === "review" && <>
			<Checkbox label="I confirm the above order details." checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
			<Button full disabled={!location || !confirmed || pending !== null} onClick={() => void issueOtp()}>{pending === "otp" ? "Sending…" : "Place Final Order"}</Button>
		</>}
		{stage === "otp" && <div className="commerce-review">
			<h2>Confirm your order</h2>
			<p className="field-note">We sent a 6-digit code to your registered email.</p>
			<OTPInput value={otp} onChange={setOtp} />
			<Button full disabled={otp.length !== 6 || pending !== null} onClick={() => void submit()}>{pending === "submit" ? "Submitting…" : "Confirm Order"}</Button>
		</div>}
		{error && <p className="commerce-validation" role="alert">{error}</p>}
	</main>;
}
