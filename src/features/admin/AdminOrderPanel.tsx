import { useMemo, useState } from "react";
import { Button } from "../../components/ui";
import { CreditHoldPanel } from "../holds/CreditHoldPanel";
import { DispatchForm } from "../dispatch/DispatchForm";
import { groupByArticle, summarizeFulfilment, type FulfilmentAllocation } from "../dispatch/fulfilment";
import "./control.css";

export interface ControlOrder { id: string; orderNumber?: string; status: string; allocations: FulfilmentAllocation[]; audit: Array<{ correlationId: string; action: string }>; }
type AdminApi = (path: string, body: object) => Promise<unknown>;
const defaultApi: AdminApi = async (path, body) => {
	const response = await fetch(path, { method: "POST", credentials: "include", headers: { "content-type": "application/json", "x-correlation-id": crypto.randomUUID() }, body: JSON.stringify(body) });
	if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error ?? "REQUEST_FAILED");
	return response.json().catch(() => ({}));
};

const rowKey = (allocation: FulfilmentAllocation) => `${allocation.orderLineId}:${allocation.size}`;

export function AdminOrderPanel({ order, api = defaultApi }: { order: ControlOrder; api?: AdminApi }) {
	const [message, setMessage] = useState(""); const [status, setStatus] = useState(order.status); const summary = summarizeFulfilment(order.allocations);
	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	const articles = useMemo(() => groupByArticle(order.allocations), [order.allocations]);
	const selected = order.allocations.find((item) => rowKey(item) === selectedKey) ?? order.allocations[0];
	async function approve() { try { await api(`/api/admin/orders/${order.id}/approve`, {}); setStatus("APPROVED"); setMessage("Order approved"); } catch { setMessage("Order could not be approved."); } }
	return <><header className="control-heading"><div><p>Orders / Review</p><h1>Order review</h1></div><span className={`control-status status-${status.toLowerCase()}`}>{status}</span></header>
		<div className="control-order-articles">{articles.map(([orderLineId, items]) => {
			const identity = items[0];
			return <section className="control-table-wrap" key={orderLineId}>
				<table>
					<caption>{identity.articleNo ? <>{identity.brand ? `${identity.brand} · ` : ""}{identity.familyName ?? identity.articleNo}{identity.articleNo !== identity.familyName ? ` · ${identity.articleNo}` : ""}{identity.colour ? ` · ${identity.colour}` : ""}</> : `Article ${orderLineId}`}</caption>
					<thead><tr><th>Size</th><th>Ordered</th><th>Dispatched</th><th>On hold</th><th>Pending</th><th /></tr></thead>
					<tbody>{items.map((item) => {
						const isSelected = rowKey(item) === rowKey(selected);
						return <tr key={rowKey(item)} className={isSelected ? "is-selected" : undefined}>
							<th>{item.size}</th><td>{item.approvedPairs}</td><td>{item.dispatchedPairs}</td><td>{item.heldPairs}</td><td>{item.approvedPairs - item.dispatchedPairs - item.heldPairs}</td>
							<td className="right"><Button variant="secondary" size="sm" aria-label={`Select size ${item.size} for dispatch or hold`} onClick={() => setSelectedKey(rowKey(item))} disabled={isSelected}>{isSelected ? "Selected" : "Select"}</Button></td>
						</tr>;
					})}</tbody>
				</table>
			</section>;
		})}</div>
		<section className="control-table-wrap"><table><caption>Order total · {order.orderNumber ?? order.id}</caption><thead><tr><th>Ordered</th><th>Dispatched</th><th>On hold</th><th>Pending</th></tr></thead><tbody><tr><td>{summary.orderedPairs}</td><td>{summary.dispatchedPairs}</td><td>{summary.heldPairs}</td><td>{summary.pendingPairs}</td></tr></tbody></table></section>
		<div className="control-actions"><section><h2>Decision</h2><Button onClick={approve} disabled={status === "APPROVED"}>Approve order</Button><Button variant="secondary">Propose revision</Button></section>{selected && <section><h2>Fulfilment · {selected.familyName ?? selected.articleNo ?? "line"} · size {selected.size}</h2><DispatchForm orderId={order.id} allocation={selected} request={api} onMessage={setMessage} /><CreditHoldPanel orderId={order.id} allocation={selected} request={api} onMessage={setMessage} /></section>}<section><h2>Audit trail</h2><ul className="audit-list">{order.audit.map((event) => <li key={`${event.action}:${event.correlationId}`}><strong>{event.action.replaceAll("_", " ")}</strong><span>{event.correlationId}</span></li>)}</ul></section></div>
		{message && <p className="control-message" role="status">{message}</p>}</>;
}
