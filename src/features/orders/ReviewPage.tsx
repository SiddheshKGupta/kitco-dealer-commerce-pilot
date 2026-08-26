import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Checkbox, OTPInput } from "../../components/ui";
import { formatSizeQuantities, sizeSystemDisplayLabel } from "../../domain/order-sizes";
import { formatRetailValue } from "../catalogue/types";
import { fetchDealerGroup, fetchDraft, mediaUrl, submitOrder, type DealerGroupPayload, type DraftLine } from "./api";

type Stage = "review" | "otp" | "submitted";
type DeliveryPreference = "ASAP" | "REQUESTED_DATE";

function pairs(quantities: Record<string, number>): number {
	return Object.values(quantities).reduce((sum, value) => sum + value, 0);
}

function todayIso(): string {
	return new Date().toISOString().slice(0, 10);
}

/** One OTP for the whole order, issued only here after every article has been
 *  reviewed -- never per article, never on the cart or product page (v4.0 §23/§48).
 *
 *  profileBlock is the "GST number and mobile number" phrase from the shared
 *  completeness rule, or null when the dealer may order. It stops the OTP being
 *  issued for an order the server will refuse anyway -- otherwise the dealer
 *  spends a real emailed code to reach a 422. It is a courtesy, not the control:
 *  the gate that actually holds is in POST /api/orders/submit, so an undefined
 *  prop (or a failed profile fetch) leaves ordering to the server as before. */
export function ReviewPage({ requestOrderOtp, profileBlock = null }: {
	requestOrderOtp: (purpose: "ORDER_SUBMISSION") => Promise<string>;
	profileBlock?: string | null;
}) {
	const [lines, setLines] = useState<DraftLine[] | null>(null);
	// Bill-To/Ship-To dealer + Ship-To location all come from one payload: each candidate
	// dealer already carries its own active SHIP_TO/BOTH locations, so switching Ship-To
	// dealer re-reads this list instead of firing a second network call
	// (V5_DEALER_GROUP_MODEL.md §3). A dealer with no group gets exactly one dealer back
	// (itself) and the pickers below never render -- checkout behaves exactly like v4.
	const [group, setGroup] = useState<DealerGroupPayload | null>(null);
	const [groupStatus, setGroupStatus] = useState<"loading" | "ready" | "error">("loading");
	const [billTo, setBillTo] = useState("");
	const [shipTo, setShipTo] = useState("");
	const [location, setLocation] = useState("");
	const [poNumber, setPoNumber] = useState("");
	const [deliveryPreference, setDeliveryPreference] = useState<DeliveryPreference>("ASAP");
	const [requestedDate, setRequestedDate] = useState("");
	const [confirmed, setConfirmed] = useState(false);
	const [stage, setStage] = useState<Stage>("review");
	const [challengeId, setChallengeId] = useState("");
	const [otp, setOtp] = useState("");
	const [error, setError] = useState("");
	const [pending, setPending] = useState<"otp" | "submit" | null>(null);
	const [resendIn, setResendIn] = useState(60);
	const idempotencyKey = useRef<string | null>(null);

	useEffect(() => {
		let active = true;
		fetchDraft().then((body) => { if (active) setLines(body.lines); }).catch(() => { if (active) setError("Current Order could not be loaded."); });
		fetchDealerGroup().then((body) => {
			if (!active) return;
			setGroup(body);
			const self = body.dealers.find((dealer) => dealer.isSelf) ?? body.dealers[0];
			if (self) { setBillTo(self.dealerId); setShipTo(self.dealerId); }
			setGroupStatus("ready");
		}).catch(() => { if (active) setGroupStatus("error"); });
		return () => { active = false; };
	}, []);
	useEffect(() => { if (stage !== "otp" || resendIn <= 0) return; const timer = window.setTimeout(() => setResendIn((value) => value - 1), 1000); return () => window.clearTimeout(timer); }, [stage, resendIn]);

	const shipToDealer = group?.dealers.find((dealer) => dealer.dealerId === shipTo);
	const locationOptions = shipToDealer?.locations ?? [];
	// Switching Ship-To dealer invalidates a location that belonged to the previous one.
	useEffect(() => { if (location && !locationOptions.some((item) => item.id === location)) setLocation(""); }, [shipTo]); // eslint-disable-line react-hooks/exhaustive-deps

	const totalPairs = useMemo(() => (lines ?? []).reduce((sum, line) => sum + pairs(line.quantities), 0), [lines]);
	const totalValue = useMemo(() => (lines ?? []).reduce((sum, line) => sum + line.retailValueMinor, 0), [lines]);
	const currencyCode = lines?.[0]?.currencyCode ?? "INR";

	async function issueOtp() {
		setError(""); setPending("otp");
		try { setChallengeId(await requestOrderOtp("ORDER_SUBMISSION")); setStage("otp"); setResendIn(60); }
		catch (caught) { setError(caught instanceof Error ? caught.message : "The order code could not be sent. Try again."); }
		finally { setPending(null); }
	}
	async function resendOtp() {
		setError("");
		try { setChallengeId(await requestOrderOtp("ORDER_SUBMISSION")); setResendIn(60); }
		catch (caught) { setError(caught instanceof Error ? caught.message : "The order code could not be sent. Try again."); }
	}
	async function submit() {
		if (otp.length !== 6 || !challengeId) return;
		setError(""); setPending("submit");
		idempotencyKey.current ??= crypto.randomUUID();
		try {
			await submitOrder({
				otpChallengeId: challengeId, otpCode: otp, idempotencyKey: idempotencyKey.current,
				billToDealerId: billTo || undefined, shipToDealerId: shipTo || undefined, shipToLocationId: location || null,
				dealerPoNumber: poNumber.trim() || undefined,
				deliveryPreference, requestedDeliveryDate: deliveryPreference === "REQUESTED_DATE" ? requestedDate : undefined,
			});
			setStage("submitted");
		} catch (caught) { setError(caught instanceof Error ? caught.message : "Order could not be submitted"); }
		finally { setPending(null); }
	}

	// A dealer with locations on file must choose one; a dealer with none (still common
	// for the 136 live pilot dealers) ships to the Ship-To dealer's registered address
	// with no location selection (V5_DEALER_GROUP_MODEL.md, orders.ship_to_location_id
	// comment) -- checkout must not dead-end on data that was never collected.
	// Fail closed while delivery details are unresolved (loading or errored) -- same as
	// v4's unconditional `!location` gate. Fail open only once resolved to genuinely zero
	// locations, which is the case the migration explicitly carves out as safe.
	const deliveryUnresolved = groupStatus !== "ready";
	const locationRequired = groupStatus === "ready" && locationOptions.length > 0;
	const dateRequired = deliveryPreference === "REQUESTED_DATE" && !requestedDate;
	const placeOrderDisabled = !confirmed || pending !== null || profileBlock !== null
		|| deliveryUnresolved || (locationRequired && !location) || dateRequired;

	if (lines === null) return <main className="commerce-page"><h1 className="sr-only">Review Order</h1><p role="status">Loading your order…</p></main>;

	if (stage === "submitted") {
		return <main className="commerce-page">
			<section className="commerce-submitted"><span aria-hidden="true">✓</span><div>
				<strong>Order submitted</strong>
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
			<h2>Bill-to / Ship-to</h2>
			{group && group.dealers.length > 1 && <>
				<label>Bill-to dealer
					<select aria-label="Bill-to dealer" value={billTo} onChange={(event) => setBillTo(event.target.value)}>
						{group.dealers.map((dealer) => <option key={dealer.dealerId} value={dealer.dealerId}>{dealer.displayName} ({dealer.dealerCode})</option>)}
					</select>
				</label>
				<label>Ship-to dealer
					<select aria-label="Ship-to dealer" value={shipTo} onChange={(event) => setShipTo(event.target.value)}>
						{group.dealers.map((dealer) => <option key={dealer.dealerId} value={dealer.dealerId}>{dealer.displayName} ({dealer.dealerCode})</option>)}
					</select>
				</label>
			</>}
			<label>Ship-to location
				<select aria-label="Ship-to location" value={location} disabled={groupStatus !== "ready" || locationOptions.length === 0} onChange={(event) => setLocation(event.target.value)}>
					<option value="">{groupStatus === "loading" ? "Loading locations…" : locationOptions.length === 0 ? "Ships to the registered address (no locations on file)" : "Choose location"}</option>
					{locationOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
				</select>
			</label>
			{groupStatus === "error" && <p className="commerce-validation" role="alert">Delivery details could not be loaded. Try again shortly.</p>}
		</section>

		<section className="commerce-review-section">
			<h2>Order details</h2>
			<label>PO number (optional)
				<input type="text" aria-label="Dealer PO number" value={poNumber} maxLength={64} onChange={(event) => setPoNumber(event.target.value)} />
			</label>
			<fieldset className="commerce-delivery-preference">
				<legend>Delivery</legend>
				<label className="commerce-delivery-option">
					<input type="radio" name="delivery-preference" checked={deliveryPreference === "ASAP"} onChange={() => setDeliveryPreference("ASAP")} />
					<span>As soon as possible</span>
				</label>
				<label className="commerce-delivery-option">
					<input type="radio" name="delivery-preference" checked={deliveryPreference === "REQUESTED_DATE"} onChange={() => setDeliveryPreference("REQUESTED_DATE")} />
					<span>On a date</span>
				</label>
				{deliveryPreference === "REQUESTED_DATE" && <div className="commerce-delivery-date">
					<label htmlFor="requested-delivery-date">Requested delivery date</label>
					<input id="requested-delivery-date" type="date" value={requestedDate} min={todayIso()} onChange={(event) => setRequestedDate(event.target.value)} />
				</div>}
			</fieldset>
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
						<span className="cart-line-size-system">Size system: {sizeSystemDisplayLabel(line.sizeSystemLabel)}</span>
						<span className="cart-line-sizes">{formatSizeQuantities(line.quantities)}</span>
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
			{profileBlock && <p className="commerce-validation" role="alert">
				Add {profileBlock} to your profile before placing an order. <a href="/profile">Complete your profile</a>
			</p>}
			<Button full disabled={placeOrderDisabled} onClick={() => void issueOtp()}>{pending === "otp" ? "Sending…" : "Place Final Order"}</Button>
		</>}
		{stage === "otp" && <div className="commerce-review">
			<h2>Confirm your order</h2>
			<p className="field-note">We sent a 6-digit code to your registered email.</p>
			<OTPInput value={otp} onChange={setOtp} />
			<Button full disabled={otp.length !== 6 || pending !== null} onClick={() => void submit()}>{pending === "submit" ? "Submitting…" : "Confirm Order"}</Button>
			<Button variant="ghost" size="md" disabled={resendIn > 0} onClick={() => void resendOtp()}>{resendIn > 0 ? `Send me a new code in ${resendIn}s` : "Send me a new code"}</Button>
		</div>}
		{error && <p className="commerce-validation" role="alert">{error}</p>}
	</main>;
}
