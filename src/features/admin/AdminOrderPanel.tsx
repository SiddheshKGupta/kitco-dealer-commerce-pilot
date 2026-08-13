import { useState } from "react";
import { CreditHoldPanel } from "../holds/CreditHoldPanel";
import { DispatchForm } from "../dispatch/DispatchForm";
import { summarizeFulfilment, type FulfilmentAllocation } from "../dispatch/fulfilment";
import { ControlNavigation } from "./ControlNavigation";
import "./control.css";

interface ControlOrder { id: string; status: string; allocations: FulfilmentAllocation[]; audit: Array<{ correlationId: string; action: string }>; }
type AdminApi = (path: string, body: object) => Promise<unknown>;
const defaultApi: AdminApi = async (path, body) => {
	const response = await fetch(path, { method: "POST", credentials: "include", headers: { "content-type": "application/json", "x-correlation-id": crypto.randomUUID() }, body: JSON.stringify(body) });
	if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error ?? "REQUEST_FAILED");
	return response.json().catch(() => ({}));
};

export function AdminOrderPanel({ order, api = defaultApi }: { order: ControlOrder; api?: AdminApi }) {
	const [message, setMessage] = useState(""); const [status, setStatus] = useState(order.status); const allocation = order.allocations[0]; const summary = summarizeFulfilment(order.allocations);
	async function approve() { try { await api(`/api/admin/orders/${order.id}/approve`, {}); setStatus("APPROVED"); setMessage("Order approved"); } catch { setMessage("Order could not be approved."); } }
	return <div className="control-layout"><ControlNavigation /><main className="control-main"><header className="control-heading"><div><p>Orders / Review</p><h1>Exception-led order control.</h1></div><span className={`control-status status-${status.toLowerCase()}`}>{status}</span></header><section className="control-table-wrap"><table><caption>Order {order.id}</caption><thead><tr><th>Size</th><th>Ordered</th><th>Dispatched</th><th>On hold</th><th>Pending</th></tr></thead><tbody>{order.allocations.map((item) => <tr key={`${item.orderLineId}:${item.size}`}><th>{item.size}</th><td>{item.approvedPairs}</td><td>{item.dispatchedPairs}</td><td>{item.heldPairs}</td><td>{item.approvedPairs - item.dispatchedPairs - item.heldPairs}</td></tr>)}</tbody><tfoot><tr><th>Total</th><td>{summary.orderedPairs}</td><td>{summary.dispatchedPairs}</td><td>{summary.heldPairs}</td><td>{summary.pendingPairs}</td></tr></tfoot></table></section><div className="control-actions"><section><h2>Decision</h2><button className="control-primary" type="button" onClick={approve} disabled={status === "APPROVED"}>Approve order</button><button type="button" className="control-secondary">Propose revision</button></section>{allocation && <section><h2>Fulfilment</h2><DispatchForm orderId={order.id} allocation={allocation} request={api} onMessage={setMessage} /><CreditHoldPanel orderId={order.id} allocation={allocation} request={api} onMessage={setMessage} /></section>}<section><h2>Audit trail</h2><ul className="audit-list">{order.audit.map((event) => <li key={`${event.action}:${event.correlationId}`}><strong>{event.action.replaceAll("_", " ")}</strong><span>{event.correlationId}</span></li>)}</ul></section></div>{message && <p className="control-message" role="status">{message}</p>}</main></div>;
}
