import { useId, useState } from "react";
import { Button, FormField, Input } from "../../components/ui";
import type { FulfilmentAllocation } from "../dispatch/fulfilment";
import { SectionState } from "./ControlSections";
import { useAdminSection } from "./useAdminSection";
import "./control.css";

/** Shape the admin order list/table (ControlConsole.tsx OrdersSection/ReportsSection) and the
 *  dealer-facing PilotSurfaces still read -- unchanged by the v5 review redesign below, which
 *  reads/writes through a separate `/review` endpoint and OrderReviewDetail shape instead. */
export interface ControlOrder { id: string; orderNumber?: string; status: string; allocations: FulfilmentAllocation[]; audit: Array<{ correlationId: string; action: string; detail: string; occurredAt: string; actorEmail: string }>; }

/* ------------------------------------------------------------- v5 review types
 * Mirrors worker/repository.ts's OrderReviewDetail/OrderReviewArticle/OrderLineSizeDecision.
 * Not imported from the worker (client code doesn't bundle server modules) -- same convention
 * as ControlOrder above, which duplicates OrderRecord's shape rather than importing it. */
interface OrderLineSizeDecision {
	orderLineId: string; size: string; orderedQty: number; approvedQty: number; creditReviewQty: number;
	rejectedQty: number; pendingQty: number; creditReviewReason: string | null; rejectionReason: string | null;
}
interface OrderReviewArticle { orderLineId: string; articleNo?: string; brand?: string; familyName?: string; colour?: string; sizes: OrderLineSizeDecision[] }
interface OrderPartnerSnapshot { dealerId?: string; code?: string; name?: string; gstin?: string; addressLine1?: string; city?: string; state?: string; pinCode?: string }
interface OrderReviewDetail {
	id: string; orderNumber: string; status: string;
	orderingDealer: OrderPartnerSnapshot | null; billTo: OrderPartnerSnapshot | null; shipTo: OrderPartnerSnapshot | null;
	dealerPoNumber: string | null; deliveryPreference: string | null; requestedDeliveryDate: string | null; estimatedDeliveryDate: string | null;
	articles: OrderReviewArticle[];
	totals: { ordered: number; approved: number; creditReview: number; rejected: number; pending: number };
	audit: Array<{ correlationId: string; action: string; detail: string; occurredAt: string; actorEmail: string }>;
}

type AdminApi = (path: string, body: object) => Promise<unknown>;
const defaultApi: AdminApi = async (path, body) => {
	const response = await fetch(path, { method: "POST", credentials: "include", headers: { "content-type": "application/json", "x-correlation-id": crypto.randomUUID() }, body: JSON.stringify(body) });
	// The API's error shape is { error: { code, message, ... } } (see worker/middleware/errors.ts)
	// -- grabbing the whole error object here instead of .message would stringify to
	// "[object Object]", silently defeating every specific-error-message check downstream.
	if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: { message?: string } }).error?.message ?? "That action could not be completed.");
	return response.json().catch(() => ({}));
};

/** v5 §4: `(8 x 10)` -- the one size x quantity format, everywhere sizes render to a human.
 *  No src/domain formatter existed from the Phase 4 checkout work at the time this was built;
 *  written inline here and worth deduplicating with Phase 4's version once it lands. */
function formatSizeQty(size: string, qty: number): string { return `(${size} x ${qty})`; }

const dash = "—";

const STATUS_META: Record<string, { label: string; tone: "green" | "amber" | "red" | "blue"; icon: "approved" | "credit_review" | "rejected" | "pending" }> = {
	SUBMITTED: { label: "Submitted", tone: "blue", icon: "pending" },
	UNDER_REVIEW: { label: "Under review", tone: "amber", icon: "pending" },
	APPROVED: { label: "Approved", tone: "green", icon: "approved" },
	PARTIALLY_APPROVED: { label: "Partially approved", tone: "amber", icon: "approved" },
	CREDIT_REVIEW: { label: "Credit review", tone: "amber", icon: "credit_review" },
	REJECTED: { label: "Rejected", tone: "red", icon: "rejected" },
	CANCELLED: { label: "Cancelled", tone: "red", icon: "rejected" },
};

/** Icon + word, never colour alone (project-wide rule). One glyph per bucket, reused for both
 *  the order-level status pill and the per-size decision badges below. */
function BucketIcon({ kind }: { kind: "approved" | "credit_review" | "rejected" | "pending" }) {
	return <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
		<circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.4" />
		{kind === "approved" && <path d="M5 8.2 7.1 10.3 11 6.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />}
		{kind === "credit_review" && <path d="M8 4.8v3.6l2.3 1.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
		{kind === "rejected" && <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />}
		{kind === "pending" && <path d="M5.2 8h5.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
	</svg>;
}

function OrderStatusBadge({ status }: { status: string }) {
	const meta = STATUS_META[status] ?? { label: status.replaceAll("_", " "), tone: "blue" as const, icon: "pending" as const };
	return <span className={`review-status review-status-${meta.tone}`}><BucketIcon kind={meta.icon} />{meta.label}</span>;
}

function BucketBadge({ kind, label, count }: { kind: "approved" | "credit_review" | "rejected" | "pending"; label: string; count: number }) {
	const tone = kind === "approved" ? "green" : kind === "credit_review" ? "amber" : kind === "rejected" ? "red" : "blue";
	return <span className={`review-status review-status-${tone} review-status-sm`}><BucketIcon kind={kind} />{count} {label}</span>;
}

function partnerLine(partner: OrderPartnerSnapshot | null): string {
	if (!partner) return dash;
	return [partner.name, partner.gstin, [partner.city, partner.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || dash;
}

function articleLabel(article: OrderReviewArticle): string {
	if (!article.articleNo) return "Article";
	const name = article.familyName ?? article.articleNo;
	return [article.brand, name, article.articleNo !== name ? article.articleNo : null, article.colour].filter(Boolean).join(" · ");
}

/** One article/size row's approve / credit review / reject decision -- replaces the whole
 *  bucket set atomically in one save (decide_kitco_order_line_v5 is a full replace, not an
 *  increment), so inputs are pre-filled from the current decision. */
function SizeDecisionRow({ orderId, orderLineId, size, api, onDecided }: {
	orderId: string; orderLineId: string; size: OrderLineSizeDecision;
	api: AdminApi; onDecided: (order: OrderReviewDetail) => void;
}) {
	const [approved, setApproved] = useState(String(size.approvedQty));
	const [creditReview, setCreditReview] = useState(String(size.creditReviewQty));
	const [rejected, setRejected] = useState(String(size.rejectedQty));
	const [creditReviewReason, setCreditReviewReason] = useState(size.creditReviewReason ?? "");
	const [rejectionReason, setRejectionReason] = useState(size.rejectionReason ?? "");
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState("");
	const approveId = useId(); const creditId = useId(); const rejectId = useId(); const creditReasonId = useId(); const rejectReasonId = useId();

	const approvedQty = Number(approved); const creditReviewQty = Number(creditReview); const rejectedQty = Number(rejected);
	const validQuantities = [approvedQty, creditReviewQty, rejectedQty].every((value) => Number.isInteger(value) && value >= 0);
	const overOrdered = validQuantities && approvedQty + creditReviewQty + rejectedQty > size.orderedQty;
	const needsCreditReason = creditReviewQty > 0 && !creditReviewReason.trim();
	const needsRejectReason = rejectedQty > 0 && !rejectionReason.trim();
	const canSave = validQuantities && !overOrdered && !needsCreditReason && !needsRejectReason;

	async function save() {
		if (!canSave) return;
		setSaving(true); setMessage("");
		try {
			const result = await api(`/api/admin/orders/${orderId}/decide-v5`, {
				orderLineId, size: size.size, approvedQty, creditReviewQty, rejectedQty,
				creditReviewReason: creditReviewQty > 0 ? creditReviewReason : null,
				rejectionReason: rejectedQty > 0 ? rejectionReason : null,
			}) as { order: OrderReviewDetail };
			setMessage("Decision saved");
			onDecided(result.order);
		} catch (caught) {
			setMessage(caught instanceof Error ? caught.message : "Decision could not be saved.");
		} finally {
			setSaving(false);
		}
	}

	return <div className="decision-card">
		<div className="decision-card-head">
			<p className="decision-card-ordered">Size {size.size} · {formatSizeQty(size.size, size.orderedQty)} ordered</p>
			<div className="review-bucket-row">
				{size.approvedQty > 0 && <BucketBadge kind="approved" label="approved" count={size.approvedQty} />}
				{size.creditReviewQty > 0 && <BucketBadge kind="credit_review" label="credit review" count={size.creditReviewQty} />}
				{size.rejectedQty > 0 && <BucketBadge kind="rejected" label="rejected" count={size.rejectedQty} />}
				{size.pendingQty > 0 && <BucketBadge kind="pending" label="pending" count={size.pendingQty} />}
			</div>
		</div>
		<div className="decision-card-grid decision-card-grid-3">
			<FormField label="Approve" htmlFor={approveId}><Input id={approveId} type="number" inputMode="numeric" min={0} max={size.orderedQty} value={approved} onChange={(event) => setApproved(event.target.value)} /></FormField>
			<FormField label="Credit review" htmlFor={creditId}><Input id={creditId} type="number" inputMode="numeric" min={0} max={size.orderedQty} value={creditReview} onChange={(event) => setCreditReview(event.target.value)} /></FormField>
			<FormField label="Reject" htmlFor={rejectId}><Input id={rejectId} type="number" inputMode="numeric" min={0} max={size.orderedQty} value={rejected} onChange={(event) => setRejected(event.target.value)} /></FormField>
		</div>
		{creditReviewQty > 0 && <FormField label="Credit review reason" htmlFor={creditReasonId}><Input id={creditReasonId} value={creditReviewReason} onChange={(event) => setCreditReviewReason(event.target.value)} placeholder="e.g. Exposure limit reached" /></FormField>}
		{rejectedQty > 0 && <FormField label="Rejection reason" htmlFor={rejectReasonId}><Input id={rejectReasonId} value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} placeholder="e.g. Out of stock" /></FormField>}
		{overOrdered && <p className="decision-card-error" role="alert">Approve, credit review and reject can&apos;t add up to more than the {size.orderedQty} pairs ordered.</p>}
		<Button onClick={save} loading={saving} disabled={!canSave} full>Save decision</Button>
		{message && <p className="decision-card-message" role="status">{message}</p>}
	</div>;
}

/** One collapsed-by-default tile per article -- most articles are approved as ordered via the
 *  whole-order action below and never need opening (that's the explicit brief this screen came
 *  from). Expanding reveals the size matrix with per-size approve/credit-review/reject. */
function ArticleTile({ orderId, article, api, onDecided }: { orderId: string; article: OrderReviewArticle; api: AdminApi; onDecided: (order: OrderReviewDetail) => void }) {
	const totals = article.sizes.reduce((sum, size) => ({
		ordered: sum.ordered + size.orderedQty, approved: sum.approved + size.approvedQty,
		creditReview: sum.creditReview + size.creditReviewQty, rejected: sum.rejected + size.rejectedQty, pending: sum.pending + size.pendingQty,
	}), { ordered: 0, approved: 0, creditReview: 0, rejected: 0, pending: 0 });
	return <details className="control-article control-size-card">
		<summary className="control-article-title control-size-card-head">
			<strong>{articleLabel(article)}</strong>
			<span>{article.sizes.map((size) => formatSizeQty(size.size, size.orderedQty)).join(", ")} · {totals.approved}/{totals.ordered} approved{totals.pending > 0 ? `, ${totals.pending} pending` : ""}</span>
		</summary>
		<div className="control-size-card-body">
			{article.sizes.map((size) => <SizeDecisionRow key={`${article.orderLineId}:${size.size}`} orderId={orderId} orderLineId={article.orderLineId} size={size} api={api} onDecided={onDecided} />)}
		</div>
	</details>;
}

export function AdminOrderPanel({ orderId, api = defaultApi }: { orderId: string; api?: AdminApi }) {
	const { data, status, reload } = useAdminSection<{ order: OrderReviewDetail }>(`/api/admin/orders/${orderId}/review`);
	const [override, setOverride] = useState<OrderReviewDetail | null>(null);
	const [approving, setApproving] = useState(false);
	const [rejecting, setRejecting] = useState(false);
	const [rejectReason, setRejectReason] = useState("");
	const [showRejectReason, setShowRejectReason] = useState(false);
	const [actionError, setActionError] = useState("");

	if (status !== "ready" || !data) return <SectionState status={status} retry={reload} />;
	const order = override ?? data.order;
	const closed = order.status === "REJECTED" || order.status === "CANCELLED";
	const hasPending = order.totals.pending > 0;

	function applyDecided(updated: OrderReviewDetail) { setOverride(updated); }

	async function approveAll() {
		setActionError(""); setApproving(true);
		try {
			const result = await api(`/api/admin/orders/${orderId}/approve-entire`, {}) as { order: OrderReviewDetail };
			applyDecided(result.order);
		} catch (caught) { setActionError(caught instanceof Error ? caught.message : "Order could not be approved."); }
		finally { setApproving(false); }
	}
	async function rejectAll() {
		if (!rejectReason.trim()) return;
		setActionError(""); setRejecting(true);
		try {
			const result = await api(`/api/admin/orders/${orderId}/reject-entire`, { reason: rejectReason }) as { order: OrderReviewDetail };
			applyDecided(result.order); setShowRejectReason(false); setRejectReason("");
		} catch (caught) { setActionError(caught instanceof Error ? caught.message : "Order could not be rejected."); }
		finally { setRejecting(false); }
	}

	return <>
		<header className="control-heading"><div><p>Orders / Review</p><h1>Order review · {order.orderNumber}</h1></div><OrderStatusBadge status={order.status} /></header>

		<dl className="control-detail-grid">
			<div><dt>Ordering dealer</dt><dd>{partnerLine(order.orderingDealer)}</dd></div>
			<div><dt>Bill-To</dt><dd>{partnerLine(order.billTo)}</dd></div>
			<div><dt>Ship-To</dt><dd>{partnerLine(order.shipTo)}</dd></div>
			<div><dt>Dealer PO number</dt><dd>{order.dealerPoNumber ?? dash}</dd></div>
			<div><dt>Delivery</dt><dd>{order.deliveryPreference === "REQUESTED_DATE" ? `Requested ${order.requestedDeliveryDate ?? dash}` : order.deliveryPreference === "ASAP" ? "As soon as possible" : dash}</dd></div>
			<div><dt>Estimated delivery</dt><dd>{order.estimatedDeliveryDate ?? dash}</dd></div>
		</dl>

		<section className="control-table-wrap"><table><caption>Order total · {order.orderNumber}</caption>
			<thead><tr><th>Ordered</th><th>Approved</th><th>Credit Review</th><th>Rejected</th><th>Pending</th></tr></thead>
			<tbody><tr><td>{order.totals.ordered}</td><td>{order.totals.approved}</td><td>{order.totals.creditReview}</td><td>{order.totals.rejected}</td><td>{order.totals.pending}</td></tr></tbody>
		</table></section>

		<div className="control-actions-row">
			<Button onClick={() => void approveAll()} loading={approving} disabled={closed || !hasPending || rejecting}>Approve entire order</Button>
			{showRejectReason ? <div className="review-reject-inline">
				<Input aria-label="Reason for rejecting the entire order" placeholder="Reason for rejecting the whole order" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} />
				<Button variant="danger" onClick={() => void rejectAll()} loading={rejecting} disabled={closed || !hasPending || !rejectReason.trim() || approving}>Confirm reject</Button>
				<Button variant="secondary" onClick={() => { setShowRejectReason(false); setRejectReason(""); }} disabled={rejecting}>Cancel</Button>
			</div> : <Button variant="danger" onClick={() => setShowRejectReason(true)} disabled={closed || !hasPending || approving}>Reject entire order</Button>}
		</div>
		{actionError && <p className="decision-card-error" role="alert">{actionError}</p>}

		<div className="control-order-articles">
			{order.articles.map((article) => <ArticleTile key={article.orderLineId} orderId={orderId} article={article} api={api} onDecided={applyDecided} />)}
		</div>

		<div className="control-actions"><section style={{ gridColumn: "1 / -1" }}><h2>Audit trail</h2><ul className="audit-list">{order.audit.map((event) => <li key={`${event.correlationId}:${event.action}`}><div><strong>{event.action}</strong><span>{new Date(event.occurredAt).toLocaleString()}</span></div>{event.detail && <p>{event.detail}</p>}<span>{event.actorEmail}</span></li>)}</ul></section></div>
	</>;
}
