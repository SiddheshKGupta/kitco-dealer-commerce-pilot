import { useState } from "react";
import { Button } from "../../components/ui";
import type { FulfilmentAllocation } from "./fulfilment";

export function DispatchForm({ orderId, allocation, request, onMessage }: { orderId: string; allocation: FulfilmentAllocation; request: (path: string, body: object) => Promise<unknown>; onMessage: (message: string) => void }) {
	const [pairs, setPairs] = useState("");
	async function dispatch() {
		try { await request("/api/admin/dispatches", { orderId, orderLineId: allocation.orderLineId, size: allocation.size, pairs: Number(pairs) }); onMessage("Dispatch recorded"); }
		catch (error) { onMessage(error instanceof Error && error.message === "DISPATCH_EXCEEDS_PENDING" ? "Dispatch exceeds the approved pending quantity." : "Dispatch could not be recorded."); }
	}
	return <div className="control-action"><label htmlFor="dispatch-pairs">Dispatch pairs</label><input id="dispatch-pairs" type="number" min="1" value={pairs} onChange={(event) => setPairs(event.target.value)} /><Button size="sm" onClick={dispatch} disabled={!Number(pairs)}>Record dispatch</Button></div>;
}
