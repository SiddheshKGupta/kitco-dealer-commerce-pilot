import { useMemo, useState } from "react";
import { Button } from "../../components/ui";
import { DispatchForm } from "../dispatch/DispatchForm";
import { groupByArticle, summarizeFulfilment, type FulfilmentAllocation } from "../dispatch/fulfilment";
import { OrderLineDecision } from "../holds/OrderLineDecision";
import "./control.css";

export interface ControlOrder { id: string; orderNumber?: string; status: string; allocations: FulfilmentAllocation[]; audit: Array<{ correlationId: string; action: string }>; }
type AdminApi = (path: string, body: object) => Promise<unknown>;
const defaultApi: AdminApi = async (path, body) => {
	const response = await fetch(path, { method: "POST", credentials: "include", headers: { "content-type": "application/json", "x-correlation-id": crypto.randomUUID() }, body: JSON.stringify(body) });
	if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error ?? "REQUEST_FAILED");
	return response.json().catch(() => ({}));
};

const rowKey = (allocation: FulfilmentAllocation) => `${allocation.orderLineId}:${allocation.size}`;

const STATUS_LABELS: Record<string, string> = {
	SUBMITTED: "Submitted", UNDER_REVIEW: "Under review", APPROVED: "Approved",
	PARTIALLY_APPROVED: "Partially approved", REJECTED: "Rejected", CANCELLED: "Cancelled",
};

/** Admin order review: one decision card per line + size (approve / hold /
 *  reason, saved atomically) instead of a whole-order approve button plus a
 *  bottom hold panel pinned to the first line. Dispatch (a later, separate
 *  step -- shipping already-decided pairs) stays inline per size too, so
 *  every action always targets the specific line+size it's rendered under. */
export function AdminOrderPanel({ order, api = defaultApi }: { order: ControlOrder; api?: AdminApi }) {
	const [message, setMessage] = useState("");
	const [status, setStatus] = useState(order.status);
	const [allocations, setAllocations] = useState(order.allocations);
	const summary = summarizeFulfilment(allocations);
	const articles = useMemo(() => groupByArticle(allocations), [allocations]);

	function handleDecided(updated: { status: string; allocations: FulfilmentAllocation[] }) {
		setStatus(updated.status);
		setAllocations(updated.allocations);
	}

	return <><header className="control-heading"><div><p>Orders / Review</p><h1>Order review</h1></div><span className={`control-status status-${status.toLowerCase()}`}>{STATUS_LABELS[status] ?? status}</span></header>
		<div className="control-order-articles">{articles.map(([orderLineId, items]) => {
			const identity = items[0];
			return <section className="control-article" key={orderLineId}>
				<h2 className="control-article-title">{identity.articleNo ? <>{identity.brand ? `${identity.brand} · ` : ""}{identity.familyName ?? identity.articleNo}{identity.articleNo !== identity.familyName ? ` · ${identity.articleNo}` : ""}{identity.colour ? ` · ${identity.colour}` : ""}</> : `Article ${orderLineId}`}</h2>
				<div className="control-size-cards">{items.map((item) => {
					const pendingPairs = item.approvedPairs - item.dispatchedPairs - item.heldPairs;
					return <article className="control-size-card" key={rowKey(item)}>
						<div className="control-size-card-head"><strong>Size {item.size}</strong><span>{item.dispatchedPairs} dispatched · {item.heldPairs} on hold · {pendingPairs} pending</span></div>
						<OrderLineDecision orderId={order.id} allocation={item} request={api} onDecided={handleDecided} />
						<DispatchForm orderId={order.id} allocation={item} request={api} onMessage={setMessage} />
					</article>;
				})}</div>
			</section>;
		})}</div>
		<section className="control-table-wrap"><table><caption>Order total · {order.orderNumber ?? order.id}</caption><thead><tr><th>Ordered</th><th>Dispatched</th><th>On hold</th><th>Pending</th></tr></thead><tbody><tr><td>{summary.orderedPairs}</td><td>{summary.dispatchedPairs}</td><td>{summary.heldPairs}</td><td>{summary.pendingPairs}</td></tr></tbody></table></section>
		<div className="control-actions"><section><h2>Revision</h2><Button variant="secondary" full>Propose revision</Button></section><section><h2>Audit trail</h2><ul className="audit-list">{order.audit.map((event) => <li key={`${event.action}:${event.correlationId}`}><strong>{event.action.replaceAll("_", " ")}</strong><span>{event.correlationId}</span></li>)}</ul></section></div>
		{message && <p className="control-message" role="status">{message}</p>}</>;
}
