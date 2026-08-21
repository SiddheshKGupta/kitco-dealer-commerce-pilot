import { useEffect, useState } from "react";
import { BottomSheet, Modal, Tabs } from "./ui";

/** Standard US/UK/EU/CM shoe-size conversion. Fixed reference data, not tied to any
 *  product or size_set -- it never changes with the catalogue. */
const MEN_SIZES = [
	{ us: "6", uk: "5.5", eu: "39", cm: "24" },
	{ us: "6.5", uk: "6", eu: "39.5", cm: "24.5" },
	{ us: "7", uk: "6.5", eu: "40", cm: "25" },
	{ us: "7.5", uk: "7", eu: "40.5", cm: "25.5" },
	{ us: "8", uk: "7.5", eu: "41", cm: "26" },
	{ us: "8.5", uk: "8", eu: "42", cm: "26.5" },
	{ us: "9", uk: "8.5", eu: "42.5", cm: "27" },
	{ us: "9.5", uk: "9", eu: "43", cm: "27.5" },
	{ us: "10", uk: "9.5", eu: "44", cm: "28" },
	{ us: "10.5", uk: "10", eu: "44.5", cm: "28.5" },
	{ us: "11", uk: "10.5", eu: "45", cm: "29" },
	{ us: "11.5", uk: "11", eu: "45.5", cm: "29.5" },
	{ us: "12", uk: "11.5", eu: "46", cm: "30" },
	{ us: "13", uk: "12.5", eu: "47", cm: "31" },
];
const WOMEN_SIZES = [
	{ us: "5", uk: "2.5", eu: "35.5", cm: "22" },
	{ us: "5.5", uk: "3", eu: "36", cm: "22.5" },
	{ us: "6", uk: "3.5", eu: "36.5", cm: "22.5" },
	{ us: "6.5", uk: "4", eu: "37", cm: "23" },
	{ us: "7", uk: "4.5", eu: "37.5", cm: "23.5" },
	{ us: "7.5", uk: "5", eu: "38", cm: "24" },
	{ us: "8", uk: "5.5", eu: "38.5", cm: "24.5" },
	{ us: "8.5", uk: "6", eu: "39", cm: "24.5" },
	{ us: "9", uk: "6.5", eu: "39.5", cm: "25" },
	{ us: "9.5", uk: "7", eu: "40", cm: "25.5" },
	{ us: "10", uk: "7.5", eu: "40.5", cm: "26" },
	{ us: "10.5", uk: "8", eu: "41", cm: "26.5" },
	{ us: "11", uk: "8.5", eu: "41.5", cm: "27" },
	{ us: "11.5", uk: "9", eu: "42", cm: "27.5" },
];

/** Mobile gets the bottom sheet, desktop the centred modal -- same content, matching
 *  how Modal/BottomSheet are meant to pair (see their doc comments). */
function useIsNarrowViewport(breakpointPx = 850): boolean {
	const supported = typeof window !== "undefined" && typeof window.matchMedia === "function";
	const query = () => window.matchMedia(`(max-width: ${breakpointPx}px)`);
	const [narrow, setNarrow] = useState(() => (supported ? query().matches : false));
	useEffect(() => {
		if (!supported) return;
		const media = query();
		const onChange = () => setNarrow(media.matches);
		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [breakpointPx, supported]);
	return narrow;
}

export function SizeChartSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
	const [tab, setTab] = useState<"men" | "women">("men");
	const narrow = useIsNarrowViewport();
	const rows = tab === "men" ? MEN_SIZES : WOMEN_SIZES;
	const body = <>
		<p className="tiny" style={{ marginBottom: 12 }}>A general guide for converting shoe sizes. Fit can still vary a little by brand and style.</p>
		<Tabs
			label="Men's or women's sizing"
			activeId={tab}
			onChange={(id) => setTab(id as "men" | "women")}
			items={[{ id: "men", label: "Men's" }, { id: "women", label: "Women's" }]}
		/>
		<div className="table-wrap" style={{ marginTop: 12 }}>
			<table className="data-table">
				<thead><tr><th>US</th><th>UK</th><th>EU</th><th>CM</th></tr></thead>
				<tbody>{rows.map((row) => <tr key={row.us}><td><b>{row.us}</b></td><td>{row.uk}</td><td>{row.eu}</td><td>{row.cm}</td></tr>)}</tbody>
			</table>
		</div>
	</>;
	return narrow
		? <BottomSheet open={open} onClose={onClose} title="Shoe Size Chart">{body}</BottomSheet>
		: <Modal open={open} onClose={onClose} title="Shoe Size Chart">{body}</Modal>;
}
