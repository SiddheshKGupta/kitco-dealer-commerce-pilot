import { useId, useState } from "react";
import { Button, FormField, Input } from "../../components/ui";
import type { FulfilmentAllocation } from "./fulfilment";

export function DispatchForm({ orderId, allocation, request, onMessage, onDispatched }: {
	orderId: string; allocation: FulfilmentAllocation; request: (path: string, body: object) => Promise<unknown>; onMessage: (message: string) => void;
	onDispatched?: (order: { status: string; allocations: FulfilmentAllocation[] }) => void;
}) {
	const [pairs, setPairs] = useState("");
	const [sending, setSending] = useState(false);
	const fieldId = useId();
	async function dispatch() {
		setSending(true);
		try {
			const result = await request("/api/admin/dispatches", { orderId, orderLineId: allocation.orderLineId, size: allocation.size, pairs: Number(pairs) }) as { order?: { status: string; allocations: FulfilmentAllocation[] } };
			onMessage("Dispatch recorded");
			setPairs("");
			if (result.order) onDispatched?.(result.order);
		}
		catch (error) { onMessage(error instanceof Error ? error.message : "Dispatch could not be recorded."); }
		finally { setSending(false); }
	}
	return <div className="control-action">
		<FormField label="Dispatch pairs" htmlFor={fieldId}>
			<Input id={fieldId} type="number" inputMode="numeric" min="1" value={pairs} onChange={(event) => setPairs(event.target.value)} />
		</FormField>
		<Button size="sm" onClick={dispatch} loading={sending} disabled={!Number(pairs) || sending} full>Record dispatch</Button>
	</div>;
}
