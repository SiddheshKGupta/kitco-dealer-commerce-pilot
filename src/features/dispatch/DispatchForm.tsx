import { useId, useState } from "react";
import { Button, FormField, Input } from "../../components/ui";
import type { FulfilmentAllocation } from "./fulfilment";

export function DispatchForm({ orderId, allocation, request, onMessage }: { orderId: string; allocation: FulfilmentAllocation; request: (path: string, body: object) => Promise<unknown>; onMessage: (message: string) => void }) {
	const [pairs, setPairs] = useState("");
	const [sending, setSending] = useState(false);
	const fieldId = useId();
	async function dispatch() {
		setSending(true);
		try { await request("/api/admin/dispatches", { orderId, orderLineId: allocation.orderLineId, size: allocation.size, pairs: Number(pairs) }); onMessage("Dispatch recorded"); }
		catch (error) { onMessage(error instanceof Error && error.message === "DISPATCH_EXCEEDS_PENDING" ? "Dispatch exceeds the approved pending quantity." : "Dispatch could not be recorded."); }
		finally { setSending(false); }
	}
	return <div className="control-action">
		<FormField label="Dispatch pairs" htmlFor={fieldId}>
			<Input id={fieldId} type="number" inputMode="numeric" min="1" value={pairs} onChange={(event) => setPairs(event.target.value)} />
		</FormField>
		<Button size="sm" onClick={dispatch} loading={sending} disabled={!Number(pairs) || sending} full>Record dispatch</Button>
	</div>;
}
