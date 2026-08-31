import { useState, type ReactNode } from "react";
import { Button, FormField, Input, SearchField, Select } from "../../components/ui";
import { SizeChartSheet } from "../../components/SizeChartSheet";
import { formatRetailValue } from "../catalogue/types";
import { adminFetch, useAdminSection, type SectionStatus } from "./useAdminSection";

const dash = "—";
/** Tolerates a missing field rather than taking the whole console down with it. */
const number = (value: number | null | undefined) => (typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-IN") : dash);
const date = (value: string | null | undefined) =>
	value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : dash;
const dateTime = (value: string | null | undefined) =>
	value ? new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : dash;

export function PageHead({ eyebrow, title, lead, actions }: { eyebrow: string; title: string; lead?: string; actions?: ReactNode }) {
	return <header className="page-head">
		<div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{lead && <p>{lead}</p>}</div>
		{actions && <div className="toolbar">{actions}</div>}
	</header>;
}

/** One honest state machine for every section: loading, denied, failed, or empty.
 *  `error` is the server's own message when it sent one -- the generic line is the
 *  fallback for when there genuinely isn't one, not the only thing anyone ever sees. */
export function SectionState({ status, retry, empty, error }: { status: SectionStatus; retry: () => void; empty?: string; error?: string | null }) {
	if (status === "loading") return <div className="empty" role="status">Loading…</div>;
	if (status === "forbidden") return <div className="empty" role="alert"><h3>Sign in required</h3><p>Sign in with your KITCO Control account to see this.</p><a className="ui-btn ui-btn-primary ui-btn-md" href="/login">Sign in</a></div>;
	if (status === "error") return <div className="empty" role="alert"><h3>Couldn't load this page</h3><p>{error || "Something went wrong. Try again."}</p><Button onClick={retry}>Try again</Button></div>;
	return <div className="empty"><h3>Nothing here yet</h3><p>{empty ?? "Nothing to show here yet."}</p></div>;
}

function Panel({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
	return <section className="panel"><div className="panel-head"><h3>{title}</h3>{meta}</div>{children}</section>;
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
	return <div className="table-wrap"><table className="data-table">
		<thead><tr>{head.map((label) => <th key={label}>{label}</th>)}</tr></thead>
		<tbody>{children}</tbody>
	</table></div>;
}

type StatusTone = "red" | "green" | "amber" | "blue";
function statusTone(value: string): StatusTone {
	const text = value.toUpperCase();
	if (["REJECT", "CANCEL", "ERROR", "FAILED", "INACTIVE"].some((token) => text.includes(token))) return "red";
	if (["APPROVED", "ACTIVE", "COMMITTED", "DISPATCHED", "RELEASED", "PUBLISHED"].some((token) => text.includes(token))) return "green";
	if (["SUBMITTED", "REVIEW", "REVISION", "PENDING", "UPLOADED", "PARTIAL", "HOLD"].some((token) => text.includes(token))) return "amber";
	return "blue";
}
/** Colour is never the only signal (project rule) -- every status pill pairs its tone with
 *  one of these four glyphs, same family as AdminOrderPanel's BucketIcon and DealerGroups'
 *  VerificationBadge. Kept local rather than shared to match how those two already do it. */
function StatusIcon({ tone }: { tone: StatusTone }) {
	return <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
		<circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.4" />
		{tone === "green" && <path d="M5 8.2 7.1 10.3 11 6.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />}
		{tone === "red" && <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />}
		{tone === "amber" && <path d="M8 4.8v3.6l2.3 1.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
		{tone === "blue" && <path d="M5.2 8h5.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
	</svg>;
}
export function StatusPill({ value }: { value: string }) {
	const tone = statusTone(value);
	return <span className={`status ${tone}`}><StatusIcon tone={tone} />{value.replaceAll("_", " ")}</span>;
}

/* ---------------------------------------------------------------- Dashboard */
interface DashboardPayload {
	orders: { total: number; pendingReview: number; approved: number };
	pairsOrdered: number; retailValueMinor: number;
	dealers: { total: number; active: number };
	catalogue: { colourways: number; published: number; withMedia: number };
}
export function DashboardSection() {
	const { data, status, error, reload } = useAdminSection<DashboardPayload>("/api/admin/console/dashboard");
	const complete = Boolean(data?.orders && data?.dealers && data?.catalogue);
	return <>
		<PageHead eyebrow="Business overview" title="Dashboard" lead="A live look at your dealers, catalogue and orders." />
		{status !== "ready" || !data || !complete ? <SectionState status={status === "ready" ? "error" : status} error={error} retry={reload} /> : <>
			<div className="stat-grid">
				<div className="stat"><div className="k">Retail Value</div><div className="v">{formatRetailValue(data.retailValueMinor ?? 0)}</div><div className="d">From submitted orders</div></div>
				<div className="stat"><div className="k">Pairs Ordered</div><div className="v">{number(data.pairsOrdered)}</div><div className="d">Across all sizes</div></div>
				<div className="stat"><div className="k">Pending Review</div><div className="v">{number(data.orders.pendingReview)}</div><div className="d">of {number(data.orders.total)} orders</div></div>
				<div className="stat"><div className="k">Active Dealers</div><div className="v">{number(data.dealers.active)}</div><div className="d">of {number(data.dealers.total)} total dealers</div></div>
			</div>
			<div className="grid-2">
				<Panel title="Catalogue readiness">
					<div className="panel-body">
						<div className="kpi-mini"><span>Colourways</span><b>{number(data.catalogue.colourways)}</b></div>
						<div className="kpi-mini"><span>Published</span><b>{number(data.catalogue.published)}</b></div>
						<div className="kpi-mini"><span>With photos</span><b>{number(data.catalogue.withMedia)}</b></div>
						<div className="bar" aria-hidden="true"><div style={{ width: `${data.catalogue.colourways ? (data.catalogue.withMedia / data.catalogue.colourways) * 100 : 0}%` }} /></div>
						<p style={{ marginTop: 8 }}>{number(data.catalogue.colourways - data.catalogue.withMedia)} colourways still need photos.</p>
					</div>
				</Panel>
				<Panel title="Orders">
					<div className="panel-body">
						<div className="kpi-mini"><span>Total orders</span><b>{number(data.orders.total)}</b></div>
						<div className="kpi-mini"><span>Approved</span><b>{number(data.orders.approved)}</b></div>
						<div className="kpi-mini"><span>Needs review</span><b>{number(data.orders.pendingReview)}</b></div>
					</div>
				</Panel>
			</div>
		</>}
	</>;
}

/* ------------------------------------------------------------------ Dealers */
interface DealerRow { id: string; code: string | null; name: string; state: string | null; city: string | null; activationStatus: string; locations: number; gstRegistrations: number; orders: number }
export function DealersSection() {
	const { data, status, error, reload } = useAdminSection<{ dealers: DealerRow[] }>("/api/admin/console/dealers");
	const [query, setQuery] = useState("");
	const rows = (data?.dealers ?? []).filter((row) => !query || `${row.name} ${row.code ?? ""} ${row.city ?? ""} ${row.state ?? ""}`.toLowerCase().includes(query.toLowerCase()));
	return <>
		<PageHead eyebrow="Dealer directory" title="Dealers" lead="Every dealer, whether they're active, their GST numbers, and where they ship to." />
		{status !== "ready" ? <SectionState status={status} error={error} retry={reload} /> : <Panel
			title={`${number(data?.dealers.length ?? 0)} dealers`}
			meta={<SearchField label="Search dealers" style={{ minWidth: 220 }} placeholder="Search dealer, city or state" value={query} onChange={(event) => setQuery(event.target.value)} />}
		>
			{rows.length === 0 ? <div className="empty"><h3>No matching dealers</h3><p>Try a different search.</p></div> : <Table head={["Dealer", "Location", "Activation", "GSTs", "Locations", "Orders"]}>
				{rows.map((row) => <tr key={row.id}>
					<td><b>{row.name}</b><div className="tiny">{row.code ?? row.id.slice(0, 8)}</div></td>
					<td>{[row.city, row.state].filter(Boolean).join(", ") || dash}</td>
					<td><StatusPill value={row.activationStatus} /></td>
					<td>{number(row.gstRegistrations)}</td>
					<td>{number(row.locations)}</td>
					<td>{number(row.orders)}</td>
				</tr>)}
			</Table>}
		</Panel>}
	</>;
}

/* ---------------------------------------------------------------- Catalogue */
interface ProductRow { id: string; articleNo: string; colour: string | null; brand: string | null; family: string | null; category: string | null; mrpMinor: number | null; published: boolean; hasMedia: boolean; offeringTypes: string[] }
export function CatalogueSection() {
	const { data, status, error, reload } = useAdminSection<{ products: ProductRow[] }>("/api/admin/console/products");
	const [query, setQuery] = useState("");
	const all = data?.products ?? [];
	const rows = all.filter((row) => !query || `${row.articleNo} ${row.brand ?? ""} ${row.family ?? ""} ${row.colour ?? ""}`.toLowerCase().includes(query.toLowerCase())).slice(0, 250);
	return <>
		<PageHead eyebrow="Catalogue" title="Catalogue" lead="Every colourway across every brand — what's published and what has photos." />
		{status !== "ready" ? <SectionState status={status} error={error} retry={reload} /> : <Panel
			title={`${number(all.length)} colourways`}
			meta={<SearchField label="Search catalogue" style={{ minWidth: 220 }} placeholder="Search article, brand or colour" value={query} onChange={(event) => setQuery(event.target.value)} />}
		>
			{rows.length === 0 ? <div className="empty"><h3>No matching products</h3><p>Try a different search.</p></div> : <>
				<Table head={["Article", "Brand / Family", "Colour", "MRP", "Media", "Published"]}>
					{rows.map((row) => <tr key={row.id}>
						<td><b>{row.articleNo}</b>{row.offeringTypes.length > 0 && <div className="tiny">{row.offeringTypes.join(" · ").replaceAll("_", " ")}</div>}</td>
						<td>{row.brand ?? dash}<div className="tiny">{row.family ?? dash}</div></td>
						<td>{row.colour ?? dash}</td>
						<td>{row.mrpMinor === null ? dash : formatRetailValue(row.mrpMinor)}</td>
						<td><span className={`status ${row.hasMedia ? "green" : "amber"}`}><StatusIcon tone={row.hasMedia ? "green" : "amber"} />{row.hasMedia ? "Ready" : "Awaiting"}</span></td>
						<td><span className={`status ${row.published ? "green" : "blue"}`}><StatusIcon tone={row.published ? "green" : "blue"} />{row.published ? "Published" : "Draft"}</span></td>
					</tr>)}
				</Table>
				{all.length > rows.length && <div className="panel-body"><p className="tiny">Showing {number(rows.length)} of {number(all.length)}. Search to see more.</p></div>}
			</>}
		</Panel>}
	</>;
}

/* ------------------------------------------------------- Commercial offerings */
interface OfferingRow { id: string; articleNo: string; offeringType: string; mrpMinor: number | null; moqPairs: number | null; orderMultiple: number | null; published: boolean }
export function OfferingsSection() {
	const { data, status, error, reload } = useAdminSection<{ offerings: OfferingRow[] }>("/api/admin/console/offerings");
	const all = data?.offerings ?? [];
	const byType = all.reduce<Record<string, number>>((acc, row) => { acc[row.offeringType] = (acc[row.offeringType] ?? 0) + 1; return acc; }, {});
	return <>
		<PageHead eyebrow="Offerings" title="Offerings" lead="How each colourway is presented to dealers: stock in hand, upcoming or prebook." />
		{status !== "ready" ? <SectionState status={status} error={error} retry={reload} /> : all.length === 0 ? <SectionState status="ready" retry={reload} empty="Nothing published yet." /> : <>
			<div className="stat-grid">
				{Object.entries(byType).map(([type, count]) => <div className="stat" key={type}>
					<div className="k">{type.replaceAll("_", " ")}</div><div className="v">{number(count)}</div><div className="d">offerings</div>
				</div>)}
			</div>
			<Panel title={`${number(all.length)} offerings`}>
				<Table head={["Article", "Type", "MRP", "MOQ", "Order multiple", "Published"]}>
					{all.slice(0, 250).map((row) => <tr key={row.id}>
						<td><b>{row.articleNo}</b></td>
						<td><StatusPill value={row.offeringType} /></td>
						<td>{row.mrpMinor === null ? dash : formatRetailValue(row.mrpMinor)}</td>
						<td>{row.moqPairs ?? dash}</td>
						<td>{row.orderMultiple ?? dash}</td>
						<td><span className={`status ${row.published ? "green" : "blue"}`}><StatusIcon tone={row.published ? "green" : "blue"} />{row.published ? "Published" : "Draft"}</span></td>
					</tr>)}
				</Table>
			</Panel>
		</>}
	</>;
}

/* ------------------------------------------------------------ Media library */
interface MediaPayload { totals: { colourways: number; withDisplayMedia: number; missing: number }; byKind: Array<{ kind: string; count: number }> }
export function MediaSection() {
	const { data, status, error, reload } = useAdminSection<MediaPayload>("/api/admin/console/media");
	return <>
		<PageHead eyebrow="Product photos" title="Media Library" lead="How many colourways have photos. Missing photos never stop an order." />
		{status !== "ready" || !data ? <SectionState status={status} error={error} retry={reload} /> : <>
			<div className="stat-grid">
				<div className="stat"><div className="k">Colourways</div><div className="v">{number(data.totals.colourways)}</div></div>
				<div className="stat"><div className="k">With photos</div><div className="v">{number(data.totals.withDisplayMedia)}</div></div>
				<div className="stat"><div className="k">Missing photos</div><div className="v">{number(data.totals.missing)}</div><div className="d">Shown with a placeholder</div></div>
				<div className="stat"><div className="k">Files stored</div><div className="v">{number(data.byKind.reduce((sum, row) => sum + row.count, 0))}</div><div className="d">All image types combined</div></div>
			</div>
			<Panel title="Photos by type">
				{data.byKind.length === 0 ? <div className="empty"><h3>No photos stored</h3><p>Upload photos to get started.</p></div>
					: <div className="panel-body">{data.byKind.map((row) => <div className="kpi-mini" key={row.kind}><span>{row.kind.replaceAll("_", " ")}</span><b>{number(row.count)}</b></div>)}</div>}
			</Panel>
		</>}
	</>;
}

/* ---------------------------------------------------------------- Size sets */
interface SizeValueRow { id: string; label: string; sortOrder: number; inUseCount: number }
interface SizeSetRow { id: string; code: string; name: string; values: SizeValueRow[]; sizeSystemId: string | null; sizeSystemLabel: string | null }
interface FamilyOptionRow { id: string; brandId: string; brandName: string; gender: string; name: string }
interface SizeSetAssignmentRow { brandName: string; gender: string; sizeSetCode: string | null; sizeSetName: string | null; colourwayCount: number }
interface SizeSystemRow { id: string; code: string; label: string }
interface SizeSetsPayload { sizeSets: SizeSetRow[]; families: FamilyOptionRow[]; assignments: SizeSetAssignmentRow[]; sizeSystems: SizeSystemRow[] }

export function SizeSetsSection() {
	const { data, status, error: loadError, reload } = useAdminSection<SizeSetsPayload>("/api/admin/size-sets");
	const sizeSets = data?.sizeSets ?? [];
	const families = data?.families ?? [];
	const assignments = data?.assignments ?? [];
	const sizeSystems = data?.sizeSystems ?? [];
	const brands = [...new Map(families.map((family) => [family.brandId, family.brandName])).entries()];

	const [error, setError] = useState("");
	const [showSizeChart, setShowSizeChart] = useState(false);
	const [assignmentQuery, setAssignmentQuery] = useState("");
	const assignmentNeedle = assignmentQuery.trim().toLowerCase();
	const visibleAssignments = assignmentNeedle
		? assignments.filter((row) => `${row.brandName} ${row.gender} ${row.sizeSetName ?? ""} ${row.sizeSetCode ?? ""}`.toLowerCase().includes(assignmentNeedle))
		: assignments;

	const [savingSystemSetId, setSavingSystemSetId] = useState<string | null>(null);
	const [newSystemCode, setNewSystemCode] = useState("");
	const [newSystemLabel, setNewSystemLabel] = useState("");
	const [creatingSystem, setCreatingSystem] = useState(false);

	const [newSetCode, setNewSetCode] = useState("");
	const [newSetName, setNewSetName] = useState("");
	const [creatingSet, setCreatingSet] = useState(false);

	const [valueDrafts, setValueDrafts] = useState<Record<string, { label: string; sortOrder: string }>>({});
	const [savingValueSetId, setSavingValueSetId] = useState<string | null>(null);

	const [confirmingValueId, setConfirmingValueId] = useState<string | null>(null);
	const [confirmText, setConfirmText] = useState("");
	const [removingValueId, setRemovingValueId] = useState<string | null>(null);

	const [assignSetId, setAssignSetId] = useState("");
	const [assignScope, setAssignScope] = useState<"family" | "brandGender">("family");
	const [assignFamilyId, setAssignFamilyId] = useState("");
	const [assignBrandId, setAssignBrandId] = useState("");
	const [assignGender, setAssignGender] = useState("");
	const [assigning, setAssigning] = useState(false);
	const [assignResult, setAssignResult] = useState<string | null>(null);
	const gendersForBrand = [...new Set(families.filter((family) => family.brandId === assignBrandId).map((family) => family.gender))];

	async function createSet() {
		setError(""); setCreatingSet(true);
		try {
			await adminFetch("/api/admin/size-sets", { method: "POST", body: JSON.stringify({ code: newSetCode.trim(), name: newSetName.trim() }) });
			setNewSetCode(""); setNewSetName(""); reload();
		} catch (caught) { setError(caught instanceof Error ? caught.message : "Size set could not be created"); }
		finally { setCreatingSet(false); }
	}

	async function setSizeSystem(setId: string, sizeSystemId: string) {
		setError(""); setSavingSystemSetId(setId);
		try {
			await adminFetch(`/api/admin/size-sets/${setId}/size-system`, { method: "PATCH", body: JSON.stringify({ sizeSystemId: sizeSystemId || null }) });
			reload();
		} catch (caught) { setError(caught instanceof Error ? caught.message : "Size system could not be saved"); }
		finally { setSavingSystemSetId(null); }
	}

	async function createSystem() {
		setError(""); setCreatingSystem(true);
		try {
			await adminFetch("/api/admin/size-systems", { method: "POST", body: JSON.stringify({ code: newSystemCode.trim(), label: newSystemLabel.trim() }) });
			setNewSystemCode(""); setNewSystemLabel(""); reload();
		} catch (caught) { setError(caught instanceof Error ? caught.message : "Size system could not be created"); }
		finally { setCreatingSystem(false); }
	}

	async function addValue(set: SizeSetRow) {
		const draft = valueDrafts[set.id] ?? { label: "", sortOrder: "" };
		if (!draft.label.trim()) return;
		setError(""); setSavingValueSetId(set.id);
		try {
			const parsedOrder = draft.sortOrder.trim() ? Number(draft.sortOrder) : NaN;
			const sortOrder = Number.isFinite(parsedOrder) ? parsedOrder : Math.max(-1, ...set.values.map((value) => value.sortOrder)) + 1;
			await adminFetch(`/api/admin/size-sets/${set.id}/values`, { method: "POST", body: JSON.stringify({ label: draft.label.trim(), sortOrder }) });
			setValueDrafts((current) => ({ ...current, [set.id]: { label: "", sortOrder: "" } }));
			reload();
		} catch (caught) { setError(caught instanceof Error ? caught.message : "Size could not be added"); }
		finally { setSavingValueSetId(null); }
	}

	async function removeValue(valueId: string) {
		setError(""); setRemovingValueId(valueId);
		try {
			await adminFetch(`/api/admin/size-sets/values/${valueId}`, { method: "DELETE" });
			setConfirmingValueId(null); setConfirmText(""); reload();
		} catch (caught) { setError(caught instanceof Error ? caught.message : "Size could not be removed"); }
		finally { setRemovingValueId(null); }
	}

	async function assign() {
		if (!assignSetId) return;
		setError(""); setAssignResult(null); setAssigning(true);
		try {
			const body = assignScope === "family"
				? { sizeSetId: assignSetId, familyId: assignFamilyId }
				: { sizeSetId: assignSetId, brandId: assignBrandId, gender: assignGender };
			const result = await adminFetch<{ colourwaysAffected: number }>("/api/admin/size-sets/assign", { method: "POST", body: JSON.stringify(body) });
			setAssignResult(`Done. Turned this size set on for ${result.colourwaysAffected} product${result.colourwaysAffected === 1 ? "" : "s"}.`);
			reload();
		} catch (caught) { setError(caught instanceof Error ? caught.message : "Size set could not be assigned"); }
		finally { setAssigning(false); }
	}

	const assignReady = assignScope === "family" ? Boolean(assignFamilyId) : Boolean(assignBrandId && assignGender);

	return <>
		<PageHead eyebrow="Catalogue configuration" title="Size Sets" lead="Per-brand size vocabulary and ordering. Add sizes, and choose which products offer which sizes." actions={<Button variant="ghost" onClick={() => setShowSizeChart(true)}>Shoe Size Chart</Button>} />
		{error && <p className="form-error" role="alert">{error}</p>}

		<section className="panel">
			<div className="panel-head"><h3>Add a size set</h3></div>
			<div className="panel-body">
				<div className="grid-2">
					<FormField label="Code" htmlFor="new-set-code" hint="Letters, numbers and underscores, e.g. REEBOK_7_13">
						<Input id="new-set-code" value={newSetCode} onChange={(event) => setNewSetCode(event.target.value)} placeholder="BRAND_RANGE" />
					</FormField>
					<FormField label="Name" htmlFor="new-set-name">
						<Input id="new-set-name" value={newSetName} onChange={(event) => setNewSetName(event.target.value)} placeholder="Reebok 7 to 13" />
					</FormField>
				</div>
				<Button disabled={!newSetCode.trim() || !newSetName.trim() || creatingSet} onClick={() => void createSet()}>{creatingSet ? "Creating…" : "Create size set"}</Button>
			</div>
		</section>

		<section className="panel">
			<div className="panel-head"><h3>Size systems</h3><span className="tiny">{sizeSystems.length} configured</span></div>
			<div className="panel-body">
				<p className="tiny" style={{ marginBottom: 12 }}>US, UK, EU, CM and IN come pre-loaded. Add another if a brand uses one of its own.</p>
				<div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
					<FormField label="System code" htmlFor="new-system-code" hint="e.g. ALPHA">
						<Input id="new-system-code" value={newSystemCode} onChange={(event) => setNewSystemCode(event.target.value)} style={{ width: 100 }} />
					</FormField>
					<FormField label="System label" htmlFor="new-system-label" hint="e.g. Alpha (S/M/L)">
						<Input id="new-system-label" value={newSystemLabel} onChange={(event) => setNewSystemLabel(event.target.value)} style={{ width: 160 }} />
					</FormField>
					<Button disabled={!newSystemCode.trim() || !newSystemLabel.trim() || creatingSystem} onClick={() => void createSystem()}>{creatingSystem ? "Adding…" : "Add size system"}</Button>
				</div>
			</div>
		</section>

		{status !== "ready" ? <SectionState status={status} error={loadError} retry={reload} /> : sizeSets.length === 0 ? <SectionState status="ready" retry={reload} empty="No size sets configured yet." /> :
			<div className="grid-2">{sizeSets.map((set) => {
				const draft = valueDrafts[set.id] ?? { label: "", sortOrder: "" };
				return <section className="panel" key={set.id}>
					<div className="panel-head"><h3>{set.name}</h3><span className="tiny">{set.code}</span></div>
					<div className="panel-body">
						<FormField label="Size system" htmlFor={`size-system-${set.id}`} hint="Shown to dealers next to these sizes at checkout. Only set this when you know it -- leave it blank rather than guess.">
							<Select id={`size-system-${set.id}`} value={set.sizeSystemId ?? ""} disabled={savingSystemSetId === set.id}
								onChange={(event) => void setSizeSystem(set.id, event.target.value)} style={{ maxWidth: 220 }}>
								<option value="">Not confirmed</option>
								{sizeSystems.map((system) => <option key={system.id} value={system.id}>{system.label}</option>)}
							</Select>
						</FormField>
						{set.values.length === 0 ? <p className="tiny">No sizes yet.</p> : <div className="table-wrap"><table className="data-table">
							<thead><tr><th>Size</th><th>Order</th><th>In use</th><th /></tr></thead>
							<tbody>{set.values.map((value) => <tr key={value.id}>
								<td><b>{value.label}</b></td>
								<td>{value.sortOrder}</td>
								<td>{value.inUseCount > 0 ? <span className="status green"><StatusIcon tone="green" />{value.inUseCount} product{value.inUseCount === 1 ? "" : "s"}</span> : <span className="tiny">Not used</span>}</td>
								<td className="right">
									{confirmingValueId === value.id ? <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
										<Input aria-label={`Type ${value.label} to confirm removing this size`} placeholder={`Type ${value.label}`} value={confirmText} onChange={(event) => setConfirmText(event.target.value)} style={{ width: 110 }} />
										<Button variant="danger" size="sm" disabled={confirmText.trim() !== value.label || removingValueId === value.id} onClick={() => void removeValue(value.id)}>{removingValueId === value.id ? "Removing…" : "Confirm"}</Button>
										<Button variant="secondary" size="sm" onClick={() => { setConfirmingValueId(null); setConfirmText(""); }}>Cancel</Button>
									</div> : <Button variant="secondary" size="sm" onClick={() => { setConfirmingValueId(value.id); setConfirmText(""); }}>Remove</Button>}
								</td>
							</tr>)}</tbody>
						</table></div>}
						<div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
							<FormField label="Add a size" htmlFor={`new-value-label-${set.id}`}>
								<Input id={`new-value-label-${set.id}`} value={draft.label} onChange={(event) => setValueDrafts((current) => ({ ...current, [set.id]: { ...draft, label: event.target.value } }))} placeholder="e.g. 13" style={{ width: 100 }} />
							</FormField>
							<FormField label="Order" htmlFor={`new-value-order-${set.id}`} hint="Optional, leave blank to add at the end">
								<Input id={`new-value-order-${set.id}`} inputMode="numeric" value={draft.sortOrder} onChange={(event) => setValueDrafts((current) => ({ ...current, [set.id]: { ...draft, sortOrder: event.target.value } }))} style={{ width: 80 }} />
							</FormField>
							<Button disabled={!draft.label.trim() || savingValueSetId === set.id} onClick={() => void addValue(set)}>{savingValueSetId === set.id ? "Adding…" : "Add size"}</Button>
						</div>
					</div>
				</section>;
			})}</div>}

		<section className="panel">
			<div className="panel-head"><h3>Turn a size set on for products</h3></div>
			<div className="panel-body">
				<p className="tiny" style={{ marginBottom: 12 }}>This turns the chosen sizes on for the products you pick. Any size an admin already turned off for one product stays off.</p>
				<div className="grid-2">
					<FormField label="Size set" htmlFor="assign-set">
						<Select id="assign-set" value={assignSetId} onChange={(event) => setAssignSetId(event.target.value)}>
							<option value="">Choose a size set</option>
							{sizeSets.map((set) => <option key={set.id} value={set.id}>{set.name} ({set.code})</option>)}
						</Select>
					</FormField>
					<FormField label="Apply to" htmlFor="assign-scope">
						<Select id="assign-scope" value={assignScope} onChange={(event) => setAssignScope(event.target.value as "family" | "brandGender")}>
							<option value="family">One product</option>
							<option value="brandGender">A whole brand and gender</option>
						</Select>
					</FormField>
				</div>
				{assignScope === "family" ? <FormField label="Product" htmlFor="assign-family">
					<Select id="assign-family" value={assignFamilyId} onChange={(event) => setAssignFamilyId(event.target.value)}>
						<option value="">Choose a product</option>
						{families.map((family) => <option key={family.id} value={family.id}>{family.brandName} · {family.gender} · {family.name}</option>)}
					</Select>
				</FormField> : <div className="grid-2">
					<FormField label="Brand" htmlFor="assign-brand">
						<Select id="assign-brand" value={assignBrandId} onChange={(event) => { setAssignBrandId(event.target.value); setAssignGender(""); }}>
							<option value="">Choose a brand</option>
							{brands.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
						</Select>
					</FormField>
					<FormField label="Gender" htmlFor="assign-gender">
						<Select id="assign-gender" value={assignGender} onChange={(event) => setAssignGender(event.target.value)} disabled={!assignBrandId}>
							<option value="">Choose gender</option>
							{gendersForBrand.map((gender) => <option key={gender} value={gender}>{gender}</option>)}
						</Select>
					</FormField>
				</div>}
				<Button disabled={assigning || !assignSetId || !assignReady} onClick={() => void assign()}>{assigning ? "Assigning…" : "Turn on for these products"}</Button>
				{assignResult && <p className="notice" style={{ marginTop: 12 }}>{assignResult}</p>}
			</div>
		</section>

		{assignments.length > 0 && <section className="panel">
			<div className="panel-head">
				<h3>What's turned on today</h3>
				<SearchField label="Search size set assignments" style={{ minWidth: 220 }} placeholder="Search brand, gender or size set" value={assignmentQuery} onChange={(event) => setAssignmentQuery(event.target.value)} />
			</div>
			{visibleAssignments.length === 0 ? <div className="empty"><h3>No matching assignments</h3><p>Try a different search.</p></div> : <div className="table-wrap"><table className="data-table">
				<thead><tr><th>Brand</th><th>Gender</th><th>Size set</th><th>Products</th></tr></thead>
				<tbody>{visibleAssignments.map((row) => <tr key={`${row.brandName}-${row.gender}-${row.sizeSetCode}`}>
					<td><b>{row.brandName}</b></td><td>{row.gender}</td><td>{row.sizeSetName ?? dash}</td><td>{number(row.colourwayCount)}</td>
				</tr>)}</tbody>
			</table></div>}
		</section>}

		<SizeChartSheet open={showSizeChart} onClose={() => setShowSizeChart(false)} />
	</>;
}

/* ---------------------------------------------------------- Catalogue imports */
interface ImportJobRow { id: string; status: string; sourceName: string | null; profileCode: string | null; createdAt: string; committedAt: string | null; rows: number }
export function ImportsSection() {
	const { data, status, error, reload } = useAdminSection<{ imports: ImportJobRow[] }>("/api/admin/console/imports");
	const [query, setQuery] = useState("");
	const all = data?.imports ?? [];
	const needle = query.trim().toLowerCase();
	// Client-side only: the list is a few hundred rows at most, never paginated.
	const rows = needle
		? all.filter((row) => `${row.sourceName ?? ""} ${row.profileCode ?? ""} ${row.status}`.toLowerCase().includes(needle))
		: all;
	return <>
		<PageHead eyebrow="Catalogue imports" title="Catalogue Imports" lead="Every file you've uploaded, which template read it, and how many rows came in." />
		{status !== "ready" ? <SectionState status={status} error={error} retry={reload} /> : all.length === 0 ? <SectionState status="ready" retry={reload} empty="No files uploaded yet." /> :
			<Panel
				title={`${number(rows.length)}${rows.length !== all.length ? ` of ${number(all.length)}` : ""} import jobs`}
				meta={<SearchField label="Search catalogue imports" style={{ minWidth: 220 }} placeholder="Search file name, profile or status" value={query} onChange={(event) => setQuery(event.target.value)} />}
			>
				{rows.length === 0 ? <div className="empty"><h3>No matching imports</h3><p>Try a different search.</p></div> : <Table head={["Source file", "Profile", "Rows", "Status", "Uploaded", "Confirmed"]}>
					{rows.map((row) => <tr key={row.id}>
						<td><b>{row.sourceName ?? dash}</b></td>
						<td>{row.profileCode ?? dash}</td>
						<td>{number(row.rows)}</td>
						<td><StatusPill value={row.status} /></td>
						<td>{date(row.createdAt)}</td>
						<td>{date(row.committedAt)}</td>
					</tr>)}
				</Table>}
			</Panel>}
	</>;
}

/* --------------------------------------------------------- Seasons & schemes */
export function SeasonsSection() {
	const { data, status, error, reload } = useAdminSection<{ seasons: Array<Record<string, string>> }>("/api/admin/console/seasons");
	const rows = data?.seasons ?? [];
	return <>
		<PageHead eyebrow="Booking calendar" title="Seasons" lead="The booking and delivery windows that set when dealers can prebook." />
		{status !== "ready" ? <SectionState status={status} error={error} retry={reload} /> : rows.length === 0 ? <SectionState status="ready" retry={reload} empty="No seasons set up yet. Prebook items need a season before dealers can order them." /> :
			<Panel title={`${number(rows.length)} seasons`}>
				<Table head={["Code", "Name", "Starts", "Ends"]}>
					{rows.map((row) => <tr key={row.id}><td><b>{row.code}</b></td><td>{row.name}</td><td>{date(row.starts_at)}</td><td>{date(row.ends_at)}</td></tr>)}
				</Table>
			</Panel>}
	</>;
}

export function SchemesSection() {
	const { data, status, error, reload } = useAdminSection<{ schemes: Array<Record<string, string>> }>("/api/admin/console/schemes");
	const rows = data?.schemes ?? [];
	return <>
		<PageHead eyebrow="Dealer incentives" title="Schemes" lead="Time-limited offers on products you already have. A scheme never creates a new catalogue entry." />
		{status !== "ready" ? <SectionState status={status} error={error} retry={reload} /> : rows.length === 0 ? <SectionState status="ready" retry={reload} empty="No schemes have been created yet." /> :
			<Panel title={`${number(rows.length)} schemes`}>
				<Table head={["Code", "Name", "Starts", "Ends", "Published"]}>
					{rows.map((row) => <tr key={row.id}><td><b>{row.code}</b></td><td>{row.name}</td><td>{date(row.starts_at)}</td><td>{date(row.ends_at)}</td><td>{row.published_at ? <span className="status green"><StatusIcon tone="green" />Live</span> : <span className="status blue"><StatusIcon tone="blue" />Draft</span>}</td></tr>)}
				</Table>
			</Panel>}
	</>;
}

/* ------------------------------------------------------- Dispatch & holds */
export function DispatchSection() {
	const { data, status, error, reload } = useAdminSection<{ dispatches: Array<Record<string, string>> }>("/api/admin/console/dispatches");
	const [query, setQuery] = useState("");
	const all = data?.dispatches ?? [];
	const needle = query.trim().toLowerCase();
	// Client-side only: the list is a few hundred rows at most, never paginated.
	const rows = needle
		? all.filter((row) => `${row.dispatch_number ?? row.id} ${row.order_id ?? ""} ${row.status ?? ""}`.toLowerCase().includes(needle))
		: all;
	return <>
		<PageHead eyebrow="Fulfilment" title="Dispatch" lead="Dispatches recorded against approved orders. One order may dispatch many times." />
		{status !== "ready" ? <SectionState status={status} error={error} retry={reload} /> : all.length === 0 ? <SectionState status="ready" retry={reload} empty="No dispatches recorded yet. Approve an order, then record dispatch against it." /> :
			<Panel
				title={`${number(rows.length)}${rows.length !== all.length ? ` of ${number(all.length)}` : ""} dispatches`}
				meta={<SearchField label="Search dispatches" style={{ minWidth: 220 }} placeholder="Search dispatch or order number" value={query} onChange={(event) => setQuery(event.target.value)} />}
			>
				{rows.length === 0 ? <div className="empty"><h3>No matching dispatches</h3><p>Try a different search.</p></div> : <Table head={["Dispatch", "Order", "Status", "Dispatched"]}>
					{rows.map((row) => <tr key={row.id}><td><b>{row.dispatch_number ?? row.id.slice(0, 8)}</b></td><td>{row.order_id?.slice(0, 8)}</td><td><StatusPill value={row.status ?? "UNKNOWN"} /></td><td>{date(row.dispatched_at)}</td></tr>)}
				</Table>}
			</Panel>}
	</>;
}

export function HoldsSection() {
	const { data, status, error, reload } = useAdminSection<{ holds: Array<Record<string, string>> }>("/api/admin/console/holds");
	const [query, setQuery] = useState("");
	const all = data?.holds ?? [];
	const needle = query.trim().toLowerCase();
	// Client-side only: the list is a few hundred rows at most, never paginated.
	const rows = needle
		? all.filter((row) => `${row.order_id ?? ""} ${row.hold_type ?? ""} ${row.status ?? ""} ${row.reason ?? ""}`.toLowerCase().includes(needle))
		: all;
	return <>
		<PageHead eyebrow="Commercial control" title="Credit Holds" lead="Holds are a separate dimension from order status and can be partial." />
		{status !== "ready" ? <SectionState status={status} error={error} retry={reload} /> : all.length === 0 ? <SectionState status="ready" retry={reload} empty="No credit holds are active." /> :
			<Panel
				title={`${number(rows.length)}${rows.length !== all.length ? ` of ${number(all.length)}` : ""} holds`}
				meta={<SearchField label="Search credit holds" style={{ minWidth: 220 }} placeholder="Search order, type or reason" value={query} onChange={(event) => setQuery(event.target.value)} />}
			>
				{rows.length === 0 ? <div className="empty"><h3>No matching holds</h3><p>Try a different search.</p></div> : <Table head={["Order", "Type", "Status", "Reason", "Raised", "Released"]}>
					{rows.map((row) => <tr key={row.id}><td>{row.order_id?.slice(0, 8)}</td><td>{row.hold_type}</td><td><StatusPill value={row.status ?? "UNKNOWN"} /></td><td>{row.reason ?? dash}</td><td>{date(row.created_at)}</td><td>{date(row.released_at)}</td></tr>)}
				</Table>}
			</Panel>}
	</>;
}

/* -------------------------------------------------------------- Audit trail */
interface AuditRow { id: string; eventType: string; entityType: string | null; entityId: string | null; correlationId: string | null; occurredAt: string; actorEmail: string | null }
export function AuditSection() {
	const { data, status, error, reload } = useAdminSection<{ audit: AuditRow[] }>("/api/admin/console/audit");
	const rows = data?.audit ?? [];
	return <>
		<PageHead eyebrow="Change history" title="Audit Trail" lead="Who did what, and when, across dealers, orders and the catalogue." />
		{status !== "ready" ? <SectionState status={status} error={error} retry={reload} /> : rows.length === 0 ? <SectionState status="ready" retry={reload} empty="No activity recorded yet." /> :
			<Panel title={`${number(rows.length)} most recent events`}>
				<Table head={["When", "Who", "Event", "Record", "Reference"]}>
					{rows.map((row) => <tr key={row.id}>
						<td>{dateTime(row.occurredAt)}</td>
						<td>{row.actorEmail ?? dash}</td>
						<td><span className="status blue"><StatusIcon tone="blue" />{row.eventType.replaceAll("_", " ")}</span></td>
						<td>{row.entityType ?? dash}<div className="tiny">{row.entityId?.slice(0, 8) ?? ""}</div></td>
						<td className="tiny">{row.correlationId?.slice(0, 8) ?? dash}</td>
					</tr>)}
				</Table>
			</Panel>}
	</>;
}

/* ----------------------------------------------------------------- Settings */
interface SettingsPayload {
	organisation: { id: string; code: string | null; name: string } | null;
	brands: Array<{ id: string; code: string | null; name: string; active: boolean }>;
	sizeSets: number;
	importProfiles: Array<{ id: string; code: string; sourceKind: string | null; active: boolean }>;
}
export function SettingsSection() {
	const { data, status, error, reload } = useAdminSection<SettingsPayload>("/api/admin/console/settings");
	return <>
		<PageHead eyebrow="Setup" title="Settings" lead="Your organisation, the brands you carry, and the templates that read supplier files." />
		{status !== "ready" || !data ? <SectionState status={status} error={error} retry={reload} /> : <div className="grid-2">
			<Panel title="Organisation">
				<div className="panel-body">
					<div className="kpi-mini"><span>Name</span><b>{data.organisation?.name ?? dash}</b></div>
					<div className="kpi-mini"><span>Code</span><b>{data.organisation?.code ?? dash}</b></div>
					<div className="kpi-mini"><span>Size sets</span><b>{number(data.sizeSets)}</b></div>
				</div>
			</Panel>
			<Panel title="Authentication">
				<div className="panel-body">
					<div className="kpi-mini"><span>Dealer sign-in</span><span className="status green"><StatusIcon tone="green" />Dealer Code/email + password</span></div>
					<div className="kpi-mini"><span>Extra check at sign-in</span><span className="status blue"><StatusIcon tone="blue" />Not required</span></div>
					<div className="kpi-mini"><span>Order submission</span><span className="status green"><StatusIcon tone="green" />Extra code required</span></div>
					<p style={{ marginTop: 12 }}>This pilot only sends codes by email — no SMS or WhatsApp yet.</p>
				</div>
			</Panel>
			<Panel title={`${number(data.brands.length)} brands`}>
				<div className="panel-body">{data.brands.length === 0 ? <p className="tiny">No brands registered.</p>
					: data.brands.map((brand) => <div className="kpi-mini" key={brand.id}><span>{brand.name}</span><span className={`status ${brand.active ? "green" : "blue"}`}><StatusIcon tone={brand.active ? "green" : "blue"} />{brand.active ? "Active" : "Inactive"}</span></div>)}</div>
			</Panel>
			<Panel title={`${number(data.importProfiles.length)} import profiles`}>
				<div className="panel-body">{data.importProfiles.length === 0 ? <p className="tiny">No import profiles registered.</p>
					: data.importProfiles.map((profile) => <div className="kpi-mini" key={profile.id}><div><b>{profile.code}</b><div className="tiny">{profile.sourceKind ?? dash}</div></div><span className={`status ${profile.active ? "green" : "blue"}`}><StatusIcon tone={profile.active ? "green" : "blue"} />{profile.active ? "Active" : "Inactive"}</span></div>)}</div>
			</Panel>
		</div>}
	</>;
}
