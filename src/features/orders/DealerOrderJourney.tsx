import { useEffect, useMemo, useRef, useState } from "react";
import { SizeGrid } from "../../components/SizeGrid";
import type { CatalogueProduct } from "../catalogue/types";
import { formatRetailValue } from "../catalogue/types";
import { fetchDealerLocations, saveDraft, submitOrder, type DealerLocation, type DraftResponse } from "./api";

type Stage = "select" | "draft" | "review" | "otp" | "submitted";

export function DealerOrderJourney({ product, requestOrderOtp, onBack }: { product: CatalogueProduct; requestOrderOtp: (purpose: "ORDER_SUBMISSION") => Promise<string>; onBack?: () => void }) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [stage, setStage] = useState<Stage>("select");
  const [location, setLocation] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [otp, setOtp] = useState("");
  const [version, setVersion] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [locations, setLocations] = useState<DealerLocation[]>([]);
  const [locationsStatus, setLocationsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [pending, setPending] = useState<"save" | "otp" | "submit" | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    void fetchDealerLocations().then((items) => { if (active) { setLocations((items ?? []).filter((item) => item.locationType !== "BILL_TO")); setLocationsStatus("ready"); } }, () => { if (active) setLocationsStatus("error"); });
    return () => { active = false; };
  }, []);
  const totalPairs = Object.values(quantities).reduce((sum, pairs) => sum + pairs, 0);
  const validation = useMemo(() => totalPairs > 0 && totalPairs < product.offering.moqPairs
    ? `Add ${product.offering.moqPairs - totalPairs} more pairs to meet the ${product.offering.moqPairs}-pair minimum.`
    : totalPairs > 0 && totalPairs % product.offering.orderMultiplePairs !== 0 ? `Order in multiples of ${product.offering.orderMultiplePairs} pairs.` : "", [product, totalPairs]);
  const add = async () => {
    if (totalPairs === 0 || validation) return;
    setError(""); setPending("save");
    try { setDraft(await saveDraft(product.offering.id, Object.fromEntries(Object.entries(quantities).filter(([, pairs]) => pairs > 0)))); setStage("draft"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Current Order could not be saved"); }
    finally { setPending(null); }
  };
  const issueOtp = async () => { setError(""); setPending("otp"); try { setChallengeId(await requestOrderOtp("ORDER_SUBMISSION")); setStage("otp"); } catch (caught) { setError(caught instanceof Error ? caught.message : "The order code could not be sent. Try again."); } finally { setPending(null); } };
  const submit = async () => {
    if (otp.length !== 6 || !challengeId) return;
    setError(""); setPending("submit");
    idempotencyKey.current ??= crypto.randomUUID();
    try { const result = await submitOrder({ otpChallengeId: challengeId, otpCode: otp, idempotencyKey: idempotencyKey.current }); setVersion(result.order.version); setStage("submitted"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Order could not be submitted"); }
    finally { setPending(null); }
  };
  return <main className="commerce-page commerce-pdp">
    {onBack && <button type="button" className="commerce-back" onClick={onBack}>← All products</button>}
    <div className="commerce-pdp-grid"><div className="commerce-pdp-media">{product.mediaUrl ? <img src={product.mediaUrl} alt={`${product.articleNo} · ${product.colour}`} /> : <div className="commerce-placeholder" role="img" aria-label={`Image unavailable for ${product.articleNo}`}><b>{product.articleNo}</b><small>Image arriving soon</small></div>}</div>
      <section className="commerce-pdp-copy"><p className="commerce-eyebrow">{product.brand} · Exact colourway</p><h1>{product.familyName ?? product.articleNo}</h1><p className="commerce-colour">{product.colour}{product.familyName ? ` · Article ${product.articleNo}` : ""}</p><p className="commerce-mrp">MRP {formatRetailValue(product.mrpMinor, product.currencyCode)}</p><div className="commerce-policy"><span>Minimum {product.offering.moqPairs} pairs</span><span>Multiple of {product.offering.orderMultiplePairs}</span></div>
        <SizeGrid sizes={product.offering.enabledSizes} quantities={quantities} onChange={(size, pairs) => setQuantities((current) => ({ ...current, [size]: pairs }))} />
        {validation && <p className="commerce-validation" role="alert">{validation}</p>}
      </section></div>
    <section className={`commerce-order-tray ${totalPairs > 0 ? "is-active" : ""}`} aria-label="Current Order action"><div><span>{totalPairs} pairs selected</span><strong>{draft ? formatRetailValue(draft.retailValueMinor, draft.currencyCode) : "Retail Value calculated by KITCO"}</strong></div><button className="commerce-primary" type="button" disabled={totalPairs === 0 || Boolean(validation) || pending !== null} onClick={() => void add()}>{pending === "save" ? "Saving…" : "Add to Current Order"}</button></section>
    {draft && <section className="commerce-current-order" aria-live="polite"><p className="commerce-eyebrow">Saved to Current Order</p><div className="commerce-order-line"><div><strong>{product.articleNo}</strong><span>{totalPairs} pairs</span></div><strong>{formatRetailValue(draft.retailValueMinor, draft.currencyCode)}</strong></div>
      <label>Ship-to location<select aria-label="Ship-to location" value={location} disabled={locationsStatus !== "ready" || locations.length === 0} onChange={(event) => setLocation(event.target.value)}><option value="">{locationsStatus === "loading" ? "Loading locations…" : locations.length === 0 ? "No ship-to locations available" : "Choose location"}</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {locationsStatus === "error" && <p className="commerce-validation" role="alert">Ship-to locations could not be loaded. Return to Products and try again.</p>}
      {stage === "draft" && <button className="commerce-primary" type="button" disabled={!location} onClick={() => setStage("review")}>Review order</button>}
      {stage === "review" && <div className="commerce-review"><h2>Review Current Order</h2><p><strong>{totalPairs} pairs</strong> allocated to {locations.find((item) => item.id === location)?.name ?? location}.</p><p>Retail Value is based on current canonical MRP and will be recalculated when submitted.</p><button className="commerce-primary" type="button" disabled={pending !== null} onClick={() => void issueOtp()}>{pending === "otp" ? "Sending…" : "Send fresh order code"}</button></div>}
      {stage === "otp" && <div className="commerce-review"><h2>Verify this order</h2><label>Order verification code<input aria-label="Order verification code" value={otp} inputMode="numeric" maxLength={6} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))} /></label><button className="commerce-primary" type="button" disabled={otp.length !== 6 || pending !== null} onClick={() => void submit()}>{pending === "submit" ? "Submitting…" : "Submit immutable order"}</button></div>}
      {stage === "submitted" && <div className="commerce-submitted"><span aria-hidden="true">✓</span><div><strong>Order submitted · Version {version}</strong><p>This version is locked. Any material change creates a new version.</p></div></div>}
    </section>}
    {error && <p className="commerce-validation" role="alert">{error}</p>}
  </main>;
}
