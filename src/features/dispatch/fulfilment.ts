export interface FulfilmentAllocation {
	orderLineId: string;
	size: string;
	approvedPairs: number;
	dispatchedPairs: number;
	heldPairs: number;
	articleNo?: string;
	colour?: string;
	familyName?: string;
	brand?: string;
}

export function summarizeFulfilment(allocations: FulfilmentAllocation[]) {
	return allocations.reduce((summary, allocation) => ({
		orderedPairs: summary.orderedPairs + allocation.approvedPairs,
		dispatchedPairs: summary.dispatchedPairs + allocation.dispatchedPairs,
		heldPairs: summary.heldPairs + allocation.heldPairs,
		pendingPairs: summary.pendingPairs + allocation.approvedPairs - allocation.dispatchedPairs - allocation.heldPairs,
	}), { orderedPairs: 0, dispatchedPairs: 0, heldPairs: 0, pendingPairs: 0 });
}

/** Groups allocations by order line (i.e. by article/size cohort), preserving first-seen order. Shared by the admin and dealer order views. */
export function groupByArticle(allocations: FulfilmentAllocation[]) {
	const groups = new Map<string, FulfilmentAllocation[]>();
	for (const item of allocations) {
		const bucket = groups.get(item.orderLineId) ?? [];
		bucket.push(item);
		groups.set(item.orderLineId, bucket);
	}
	return [...groups.entries()];
}
