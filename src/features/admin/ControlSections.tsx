import { useState, type ReactNode } from "react";
import { Button, SearchField } from "../../components/ui";
import { formatRetailValue } from "../catalogue/types";
import { useAdminSection, type SectionStatus } from "./useAdminSection";

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

/** One honest state machine for every section: loading, denied, failed, or empty. */
export function SectionState({ status, retry, empty }: { status: SectionStatus; retry: () => void; empty?: string }) {
	if (status === "loading") return <div className="empty" role="status">Loading…</div>;
	if (status === "forbidden") return <div className="empty" role="alert"><h3>Administrator access required</h3><p>Sign in with a KITCO Control account to view this section.</p><a className="ui-btn ui-btn-primary ui-btn-md" href="/login">Sign in</a></div>;
	if (status === "error") return <div className="empty" role="alert"><h3>This section could not be loaded</h3><p>The request did not complete.</p><Button onClick={retry}>Try again</Button></div>;
	return <div className="empty"><h3>Nothing here yet</h3><p>{empty ?? "No records exist for this organisation yet."}</p></div>;
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

function statusTone(value: string): string {
	const text = value.toUpperCase();
	if (["APPROVED", "ACTIVE", "COMMITTED", "DISPATCHED", "RELEASED", "PUBLISHED"].some((token) => text.includes(token))) return "green";
	if (["SUBMITTED", "REVIEW", "REVISION", "PENDING", "UPLOADED", "PARTIAL", "HOLD"].some((token) => text.includes(token))) return "amber";
	if (["REJECT", "CANCEL", "ERROR", "FAILED"].some((token) => text.includes(token))) return "red";
	return "blue";
}
export function StatusPill({ value }: { value: string }) {
	return <span className={`status ${statusTone(value)}`}>{value.replaceAll("_", " ")}</span>;
}

/* ---------------------------------------------------------------- Dashboard */
interface DashboardPayload {
	orders: { total: number; pendingReview: number; approved: number };
	pairsOrdered: number; retailValueMinor: number;
	dealers: { total: number; active: number };
	catalogue: { colourways: number; published: number; withMedia: number };
}
export function DashboardSection() {
	const { data, status, reload } = useAdminSection<DashboardPayload>("/api/admin/console/dashboard");
	const complete = Boolean(data?.orders && data?.dealers && data?.catalogue);
	return <>
		<PageHead eyebrow="Management command centre" title="Dashboard" lead="Live commercial state across dealers, catalogue and the order book." />
		{status !== "ready" || !data || !complete ? <SectionState status={status === "ready" ? "error" : status} retry={reload} /> : <>
			<div className="stat-grid">
				<div className="stat"><div className="k">Retail Value</div><div className="v">{formatRetailValue(data.retailValueMinor ?? 0)}</div><div className="d">Submitted order versions</div></div>
				<div className="stat"><div className="k">Pairs Ordered</div><div className="v">{number(data.pairsOrdered)}</div><div className="d">Across all sizes</div></div>
				<div className="stat"><div className="k">Pending Review</div><div className="v">{number(data.orders.pendingReview)}</div><div className="d">of {number(data.orders.total)} orders</div></div>
				<div className="stat"><div className="k">Active Dealers</div><div className="v">{number(data.dealers.active)}</div><div className="d">of {number(data.dealers.total)} on the master</div></div>
			</div>
			<div className="grid-2">
				<Panel title="Catalogue readiness">
					<div className="panel-body">
						<div className="kpi-mini"><span>Colourways</span><b>{number(data.catalogue.colourways)}</b></div>
						<div className="kpi-mini"><span>Published</span><b>{number(data.catalogue.published)}</b></div>
						<div className="kpi-mini"><span>With display media</span><b>{number(data.catalogue.withMedia)}</b></div>
						<div className="bar" aria-hidden="true"><div style={{ width: `${data.catalogue.colourways ? (data.catalogue.withMedia / data.catalogue.colourways) * 100 : 0}%` }} /></div>
						<p className="tiny" style={{ marginTop: 8 }}>{number(data.catalogue.colourways - data.catalogue.withMedia)} colourways still awaiting photography.</p>
					</div>
				</Panel>
				<Panel title="Order book">
					<div className="panel-body">
						<div className="kpi-mini"><span>Total orders</span><b>{number(data.orders.total)}</b></div>
						<div className="kpi-mini"><span>Approved</span><b>{number(data.orders.approved)}</b></div>
						<div className="kpi-mini"><span>Awaiting KITCO action</span><b>{number(data.orders.pendingReview)}</b></div>
					</div>
				</Panel>
			</div>
		</>}
	</>;
}

/* ------------------------------------------------------------------ Dealers */
interface DealerRow { id: string; code: string | null; name: string; state: string | null; city: string | null; activationStatus: string; locations: number; gstRegistrations: number; orders: number }
export function DealersSection() {
	const { data, status, reload } = useAdminSection<{ dealers: DealerRow[] }>("/api/admin/console/dealers");
	const [query, setQuery] = useState("");
	const rows = (data?.dealers ?? []).filter((row) => !query || `${row.name} ${row.code ?? ""} ${row.city ?? ""} ${row.state ?? ""}`.toLowerCase().includes(query.toLowerCase()));
	return <>
		<PageHead eyebrow="Dealer master" title="Dealers" lead="Identity, activation state, GST registrations and delivery locations." />
		{status !== "ready" ? <SectionState status={status} retry={reload} /> : <Panel
			title={`${number(data?.dealers.length ?? 0)} dealers`}
			meta={<SearchField label="Search dealers" style={{ minWidth: 220 }} placeholder="Search dealer, city or state" value={query} onChange={(event) => setQuery(event.target.value)} />}
		>
			{rows.length === 0 ? <div className="empty"><h3>No matching dealers</h3><p>Adjust the search to see more of the master.</p></div> : <Table head={["Dealer", "Location", "Activation", "GSTs", "Locations", "Orders"]}>
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
	const { data, status, reload } = useAdminSection<{ products: ProductRow[] }>("/api/admin/console/products");
	const [query, setQuery] = useState("");
	const all = data?.products ?? [];
	const rows = all.filter((row) => !query || `${row.articleNo} ${row.brand ?? ""} ${row.family ?? ""} ${row.colour ?? ""}`.toLowerCase().includes(query.toLowerCase())).slice(0, 250);
	return <>
		<PageHead eyebrow="Catalogue master" title="Catalogue" lead="Colourways, publication state and media readiness across every brand." />
		{status !== "ready" ? <SectionState status={status} retry={reload} /> : <Panel
			title={`${number(all.length)} colourways`}
			meta={<SearchField label="Search catalogue" style={{ minWidth: 220 }} placeholder="Search article, brand or colour" value={query} onChange={(event) => setQuery(event.target.value)} />}
		>
			{rows.length === 0 ? <div className="empty"><h3>No matching products</h3><p>Adjust the search to see more of the catalogue.</p></div> : <>
				<Table head={["Article", "Brand / Family", "Colour", "MRP", "Media", "Published"]}>
					{rows.map((row) => <tr key={row.id}>
						<td><b>{row.articleNo}</b>{row.offeringTypes.length > 0 && <div className="tiny">{row.offeringTypes.join(" · ").replaceAll("_", " ")}</div>}</td>
						<td>{row.brand ?? dash}<div className="tiny">{row.family ?? dash}</div></td>
						<td>{row.colour ?? dash}</td>
						<td>{row.mrpMinor === null ? dash : formatRetailValue(row.mrpMinor)}</td>
						<td><span className={`status ${row.hasMedia ? "green" : "amber"}`}>{row.hasMedia ? "Ready" : "Awaiting"}</span></td>
						<td><span className={`status ${row.published ? "green" : "blue"}`}>{row.published ? "Published" : "Draft"}</span></td>
					</tr>)}
				</Table>
				{all.length > rows.length && <div className="panel-body"><p className="tiny">Showing {number(rows.length)} of {number(all.length)}. Refine the search to narrow further.</p></div>}
			</>}
		</Panel>}
	</>;
}

/* ------------------------------------------------------- Commercial offerings */
interface OfferingRow { id: string; articleNo: string; offeringType: string; mrpMinor: number | null; moqPairs: number | null; orderMultiple: number | null; published: boolean }
export function OfferingsSection() {
	const { data, status, reload } = useAdminSection<{ offerings: OfferingRow[] }>("/api/admin/console/offerings");
	const all = data?.offerings ?? [];
	const byType = all.reduce<Record<string, number>>((acc, row) => { acc[row.offeringType] = (acc[row.offeringType] ?? 0) + 1; return acc; }, {});
	return <>
		<PageHead eyebrow="Commercial architecture" title="Commercial Offerings" lead="How each colourway is presented to dealers: stock in hand, upcoming or prebook." />
		{status !== "ready" ? <SectionState status={status} retry={reload} /> : all.length === 0 ? <SectionState status="ready" retry={reload} empty="No commercial offerings have been published yet." /> : <>
			<div className="stat-grid">
				{Object.entries(byType).map(([type, count]) => <div className="stat" key={type}>
					<div className="k">{type.replaceAll("_", " ")}</div><div className="v">{number(count)}</div><div className="d">offerings</div>
				</div>)}
			</div>
			<Panel title={`${number(all.length)} offerings`}>
				<Table head={["Article", "Type", "MRP", "MOQ", "Multiple", "Published"]}>
					{all.slice(0, 250).map((row) => <tr key={row.id}>
						<td><b>{row.articleNo}</b></td>
						<td><StatusPill value={row.offeringType} /></td>
						<td>{row.mrpMinor === null ? dash : formatRetailValue(row.mrpMinor)}</td>
						<td>{row.moqPairs ?? dash}</td>
						<td>{row.orderMultiple ?? dash}</td>
						<td><span className={`status ${row.published ? "green" : "blue"}`}>{row.published ? "Published" : "Draft"}</span></td>
					</tr>)}
				</Table>
			</Panel>
		</>}
	</>;
}

/* ------------------------------------------------------------ Media library */
interface MediaPayload { totals: { colourways: number; withDisplayMedia: number; missing: number }; byKind: Array<{ kind: string; count: number }> }
export function MediaSection() {
	const { data, status, reload } = useAdminSection<MediaPayload>("/api/admin/console/media");
	return <>
		<PageHead eyebrow="Product media" title="Media Library" lead="Display-image coverage across the catalogue. Missing media never blocks ordering." />
		{status !== "ready" || !data ? <SectionState status={status} retry={reload} /> : <>
			<div className="stat-grid">
				<div className="stat"><div className="k">Colourways</div><div className="v">{number(data.totals.colourways)}</div></div>
				<div className="stat"><div className="k">With display media</div><div className="v">{number(data.totals.withDisplayMedia)}</div></div>
				<div className="stat"><div className="k">Awaiting media</div><div className="v">{number(data.totals.missing)}</div><div className="d">Shown with a placeholder</div></div>
				<div className="stat"><div className="k">Stored objects</div><div className="v">{number(data.byKind.reduce((sum, row) => sum + row.count, 0))}</div><div className="d">Across all variants</div></div>
			</div>
			<Panel title="Objects by kind">
				{data.byKind.length === 0 ? <div className="empty"><h3>No media stored</h3><p>Upload product photography to populate the library.</p></div>
					: <div className="panel-body">{data.byKind.map((row) => <div className="kpi-mini" key={row.kind}><span>{row.kind.replaceAll("_", " ")}</span><b>{number(row.count)}</b></div>)}</div>}
			</Panel>
		</>}
	</>;
}

/* ---------------------------------------------------------------- Size sets */
interface SizeSetRow { id: string; code: string; name: string; values: string[] }
export function SizeSetsSection() {
	const { data, status, reload } = useAdminSection<{ sizeSets: SizeSetRow[] }>("/api/admin/console/size-sets");
	const rows = data?.sizeSets ?? [];
	return <>
		<PageHead eyebrow="Catalogue configuration" title="Size Sets" lead="Per-brand size vocabulary and ordering. Products enable only the values they actually run." />
		{status !== "ready" ? <SectionState status={status} retry={reload} /> : rows.length === 0 ? <SectionState status="ready" retry={reload} empty="No size sets configured yet." /> :
			<div className="grid-3">{rows.map((row) => <section className="panel" key={row.id}>
				<div className="panel-head"><h3>{row.name}</h3><span className="tiny">{row.code}</span></div>
				<div className="panel-body">
					<div className="toolbar">{row.values.map((value) => <span className="chip" key={value} style={{ cursor: "default" }}>{value}</span>)}</div>
					{row.values.length === 0 && <p className="tiny">No size values defined.</p>}
				</div>
			</section>)}</div>}
	</>;
}

/* ---------------------------------------------------------- Catalogue imports */
interface ImportJobRow { id: string; status: string; sourceName: string | null; profileCode: string | null; createdAt: string; committedAt: string | null; rows: number }
export function ImportsSection() {
	const { data, status, reload } = useAdminSection<{ imports: ImportJobRow[] }>("/api/admin/console/imports");
	const rows = data?.imports ?? [];
	return <>
		<PageHead eyebrow="Source-file driven catalogue" title="Catalogue Imports" lead="Every uploaded brand source, the profile that parsed it and what it staged." />
		{status !== "ready" ? <SectionState status={status} retry={reload} /> : rows.length === 0 ? <SectionState status="ready" retry={reload} empty="No catalogue imports have been run yet." /> :
			<Panel title={`${number(rows.length)} import jobs`}>
				<Table head={["Source file", "Profile", "Rows staged", "Status", "Uploaded", "Committed"]}>
					{rows.map((row) => <tr key={row.id}>
						<td><b>{row.sourceName ?? dash}</b></td>
						<td>{row.profileCode ?? dash}</td>
						<td>{number(row.rows)}</td>
						<td><StatusPill value={row.status} /></td>
						<td>{date(row.createdAt)}</td>
						<td>{date(row.committedAt)}</td>
					</tr>)}
				</Table>
			</Panel>}
	</>;
}

/* --------------------------------------------------------- Seasons & schemes */
export function SeasonsSection() {
	const { data, status, reload } = useAdminSection<{ seasons: Array<Record<string, string>> }>("/api/admin/console/seasons");
	const rows = data?.seasons ?? [];
	return <>
		<PageHead eyebrow="Commercial calendar" title="Seasons" lead="Booking and delivery windows that govern when dealers can prebook." />
		{status !== "ready" ? <SectionState status={status} retry={reload} /> : rows.length === 0 ? <SectionState status="ready" retry={reload} empty="No seasons configured yet. Prebook offerings need a season before dealers can book them." /> :
			<Panel title={`${number(rows.length)} seasons`}>
				<Table head={["Code", "Name", "Starts", "Ends"]}>
					{rows.map((row) => <tr key={row.id}><td><b>{row.code}</b></td><td>{row.name}</td><td>{date(row.starts_at)}</td><td>{date(row.ends_at)}</td></tr>)}
				</Table>
			</Panel>}
	</>;
}

export function SchemesSection() {
	const { data, status, reload } = useAdminSection<{ schemes: Array<Record<string, string>> }>("/api/admin/console/schemes");
	const rows = data?.schemes ?? [];
	return <>
		<PageHead eyebrow="Dealer incentives" title="Schemes" lead="Dated commercial schemes attach to existing products — never duplicate catalogue entries." />
		{status !== "ready" ? <SectionState status={status} retry={reload} /> : rows.length === 0 ? <SectionState status="ready" retry={reload} empty="No schemes have been created yet." /> :
			<Panel title={`${number(rows.length)} schemes`}>
				<Table head={["Code", "Name", "Starts", "Ends", "Published"]}>
					{rows.map((row) => <tr key={row.id}><td><b>{row.code}</b></td><td>{row.name}</td><td>{date(row.starts_at)}</td><td>{date(row.ends_at)}</td><td>{row.published_at ? <span className="status green">Live</span> : <span className="status blue">Draft</span>}</td></tr>)}
				</Table>
			</Panel>}
	</>;
}

/* ------------------------------------------------------- Dispatch & holds */
export function DispatchSection() {
	const { data, status, reload } = useAdminSection<{ dispatches: Array<Record<string, string>> }>("/api/admin/console/dispatches");
	const rows = data?.dispatches ?? [];
	return <>
		<PageHead eyebrow="Fulfilment" title="Dispatch" lead="Dispatches recorded against approved orders. One order may dispatch many times." />
		{status !== "ready" ? <SectionState status={status} retry={reload} /> : rows.length === 0 ? <SectionState status="ready" retry={reload} empty="No dispatches recorded yet. Approve an order, then record dispatch against it." /> :
			<Panel title={`${number(rows.length)} dispatches`}>
				<Table head={["Dispatch", "Order", "Status", "Dispatched"]}>
					{rows.map((row) => <tr key={row.id}><td><b>{row.dispatch_number ?? row.id.slice(0, 8)}</b></td><td>{row.order_id?.slice(0, 8)}</td><td><StatusPill value={row.status ?? "UNKNOWN"} /></td><td>{date(row.dispatched_at)}</td></tr>)}
				</Table>
			</Panel>}
	</>;
}

export function HoldsSection() {
	const { data, status, reload } = useAdminSection<{ holds: Array<Record<string, string>> }>("/api/admin/console/holds");
	const rows = data?.holds ?? [];
	return <>
		<PageHead eyebrow="Commercial control" title="Credit Holds" lead="Holds are a separate dimension from order status and can be partial." />
		{status !== "ready" ? <SectionState status={status} retry={reload} /> : rows.length === 0 ? <SectionState status="ready" retry={reload} empty="No credit holds are active." /> :
			<Panel title={`${number(rows.length)} holds`}>
				<Table head={["Order", "Type", "Status", "Reason", "Raised", "Released"]}>
					{rows.map((row) => <tr key={row.id}><td>{row.order_id?.slice(0, 8)}</td><td>{row.hold_type}</td><td><StatusPill value={row.status ?? "UNKNOWN"} /></td><td>{row.reason ?? dash}</td><td>{date(row.created_at)}</td><td>{date(row.released_at)}</td></tr>)}
				</Table>
			</Panel>}
	</>;
}

/* -------------------------------------------------------------- Audit trail */
interface AuditRow { id: string; eventType: string; entityType: string | null; entityId: string | null; correlationId: string | null; occurredAt: string }
export function AuditSection() {
	const { data, status, reload } = useAdminSection<{ audit: AuditRow[] }>("/api/admin/console/audit");
	const rows = data?.audit ?? [];
	return <>
		<PageHead eyebrow="Immutable evidence layer" title="Audit Trail" lead="Who changed what, when, and against which business object." />
		{status !== "ready" ? <SectionState status={status} retry={reload} /> : rows.length === 0 ? <SectionState status="ready" retry={reload} empty="No audit events recorded yet." /> :
			<Panel title={`${number(rows.length)} most recent events`}>
				<Table head={["When", "Event", "Entity", "Correlation"]}>
					{rows.map((row) => <tr key={row.id}>
						<td>{dateTime(row.occurredAt)}</td>
						<td><span className="status blue">{row.eventType.replaceAll("_", " ")}</span></td>
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
	const { data, status, reload } = useAdminSection<SettingsPayload>("/api/admin/console/settings");
	return <>
		<PageHead eyebrow="Platform masters" title="Settings" lead="Organisation boundary, brands and the import profiles that parse brand sources." />
		{status !== "ready" || !data ? <SectionState status={status} retry={reload} /> : <div className="grid-2">
			<Panel title="Organisation">
				<div className="panel-body">
					<div className="kpi-mini"><span>Name</span><b>{data.organisation?.name ?? dash}</b></div>
					<div className="kpi-mini"><span>Code</span><b>{data.organisation?.code ?? dash}</b></div>
					<div className="kpi-mini"><span>Tenant model</span><b>Single organisation</b></div>
					<div className="kpi-mini"><span>Size sets</span><b>{number(data.sizeSets)}</b></div>
				</div>
			</Panel>
			<Panel title="Authentication">
				<div className="panel-body">
					<div className="kpi-mini"><span>Dealer sign-in</span><span className="status green">Email + password</span></div>
					<div className="kpi-mini"><span>Second factor</span><span className="status green">Email OTP</span></div>
					<div className="kpi-mini"><span>Order submission</span><span className="status green">Purpose-specific OTP</span></div>
					<p className="tiny" style={{ marginTop: 12 }}>Pilot is email-only. SMS and WhatsApp channels are not exposed.</p>
				</div>
			</Panel>
			<Panel title={`${number(data.brands.length)} brands`}>
				<div className="panel-body">{data.brands.length === 0 ? <p className="tiny">No brands registered.</p>
					: data.brands.map((brand) => <div className="kpi-mini" key={brand.id}><span>{brand.name}</span><span className={`status ${brand.active ? "green" : "blue"}`}>{brand.active ? "Active" : "Inactive"}</span></div>)}</div>
			</Panel>
			<Panel title={`${number(data.importProfiles.length)} import profiles`}>
				<div className="panel-body">{data.importProfiles.length === 0 ? <p className="tiny">No import profiles registered.</p>
					: data.importProfiles.map((profile) => <div className="kpi-mini" key={profile.id}><div><b>{profile.code}</b><div className="tiny">{profile.sourceKind ?? dash}</div></div><span className={`status ${profile.active ? "green" : "blue"}`}>{profile.active ? "Active" : "Inactive"}</span></div>)}</div>
			</Panel>
		</div>}
	</>;
}
