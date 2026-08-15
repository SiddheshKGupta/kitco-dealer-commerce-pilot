import { useId, useState } from "react";
import { Button, FormField, Input, Select } from "../../components/ui";
import { HOLD_REASONS, type FulfilmentAllocation } from "../dispatch/fulfilment";

const HOLD_REASON_LABELS: Record<string, string> = {
	CREDIT_HOLD: "Credit hold",
	STOCK_REVIEW: "Stock review",
	COMMERCIAL_REVIEW: "Commercial review",
	ALLOCATION_PENDING: "Allocation pending",
	MANUAL_REVIEW: "Manual review",
	OTHER: "Other",
};

/** One order line + size's approve/hold decision -- the atomic replacement for
 *  the old whole-order "Approve order" button plus a separate post-approval
 *  credit hold step. Approve and hold pairs are decided together in one save,
 *  and can never add up to more than what the dealer ordered for this size. */
export function OrderLineDecision({ orderId, allocation, request, onDecided }: {
	orderId: string;
	allocation: FulfilmentAllocation;
	request: (path: string, body: object) => Promise<unknown>;
	onDecided: (order: { status: string; allocations: FulfilmentAllocation[] }) => void;
}) {
	const orderedPairs = allocation.orderedPairs ?? allocation.approvedPairs;
	const [approved, setApproved] = useState(String(allocation.approvedPairs));
	const [held, setHeld] = useState(String(allocation.heldPairs));
	const [reason, setReason] = useState(allocation.holdReason ?? "");
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState("");
	const approveId = useId(); const holdId = useId(); const reasonId = useId();

	const approvedPairs = Number(approved);
	const heldPairs = Number(held);
	const validQuantities = Number.isInteger(approvedPairs) && approvedPairs >= 0 && Number.isInteger(heldPairs) && heldPairs >= 0;
	const overOrdered = validQuantities && approvedPairs + heldPairs > orderedPairs;
	const needsReason = heldPairs > 0 && !reason;
	const canSave = validQuantities && !overOrdered && !needsReason;

	async function save() {
		if (!canSave) return;
		setSaving(true); setMessage("");
		try {
			const result = await request(`/api/admin/orders/${orderId}/decide`, {
				orderLineId: allocation.orderLineId, size: allocation.size,
				approvedPairs, heldPairs, holdReason: heldPairs > 0 ? reason : null,
			}) as { order: { status: string; allocations: FulfilmentAllocation[] } };
			setMessage("Decision saved");
			onDecided(result.order);
		} catch {
			setMessage("Decision could not be saved.");
		} finally {
			setSaving(false);
		}
	}

	return <div className="decision-card">
		<p className="decision-card-ordered">{orderedPairs} {orderedPairs === 1 ? "pair" : "pairs"} ordered · size {allocation.size}</p>
		<div className="decision-card-grid">
			<FormField label="Approve pairs" htmlFor={approveId}>
				<Input id={approveId} type="number" inputMode="numeric" min={0} max={orderedPairs} value={approved} onChange={(event) => setApproved(event.target.value)} />
			</FormField>
			<FormField label="Hold pairs" htmlFor={holdId}>
				<Input id={holdId} type="number" inputMode="numeric" min={0} max={orderedPairs} value={held} onChange={(event) => setHeld(event.target.value)} />
			</FormField>
		</div>
		{heldPairs > 0 && <FormField label="Hold reason" htmlFor={reasonId}>
			<Select id={reasonId} value={reason} onChange={(event) => setReason(event.target.value)}>
				<option value="">Choose a reason</option>
				{HOLD_REASONS.map((value) => <option key={value} value={value}>{HOLD_REASON_LABELS[value]}</option>)}
			</Select>
		</FormField>}
		{overOrdered && <p className="decision-card-error" role="alert">Approve + hold can&apos;t add up to more than the {orderedPairs} pairs ordered.</p>}
		<Button onClick={save} loading={saving} disabled={!canSave} full>Save decision</Button>
		{message && <p className="decision-card-message" role="status">{message}</p>}
	</div>;
}
