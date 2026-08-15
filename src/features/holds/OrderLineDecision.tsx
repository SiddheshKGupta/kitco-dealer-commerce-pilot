import { useState } from "react";
import { Button } from "../../components/ui";
import type { FulfilmentAllocation } from "../dispatch/fulfilment";

export function CreditHoldPanel({ orderId, allocation, request, onMessage }: { orderId: string; allocation: FulfilmentAllocation; request: (path: string, body: object) => Promise<unknown>; onMessage: (message: string) => void }) {
	const [pairs, setPairs] = useState(""); const [reason, setReason] = useState("");
	async function apply() {
		try { await request("/api/admin/holds", { orderId, orderLineId: allocation.orderLineId, size: allocation.size, pairs: Number(pairs), reason }); onMessage("Credit Hold applied"); }
		catch { onMessage("Credit Hold could not be applied."); }
	}
	return <div className="control-action"><label htmlFor="hold-pairs">Hold pairs</label><input id="hold-pairs" type="number" min="1" value={pairs} onChange={(event) => setPairs(event.target.value)} /><label htmlFor="hold-reason">Hold reason</label><input id="hold-reason" value={reason} onChange={(event) => setReason(event.target.value)} /><Button size="sm" onClick={apply} disabled={!Number(pairs) || !reason.trim()}>Apply Credit Hold</Button></div>;
}
