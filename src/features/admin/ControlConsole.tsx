import { useEffect, useState } from "react";
import { Button, FormField, Input, SearchField, Select } from "../../components/ui";
import { formatRetailValue } from "../catalogue/types";
import { AdminOrderPanel, type ControlOrder } from "./AdminOrderPanel";
import {
	AuditSection, CatalogueSection, DashboardSection, DealersSection, DispatchSection,
	HoldsSection, ImportsSection, MediaSection, OfferingsSection, PageHead, SchemesSection,
	SeasonsSection, SectionState, SettingsSection, SizeSetsSection, StatusPill,
} from "./ControlSections";
import { DealerGroupsSection, GroupRequestsSection, GstRegistrationsSection } from "./DealerGroups";
import { DealerImportSection, DealerOnboardingSection } from "./DealerOnboarding";
import { OrdersTable } from "../reports/OrdersTable";
import { post, useAdminSection } from "./useAdminSection";
import "./control.css";

interface LiveOrder extends ControlOrder { version?: number; retailValueMinor?: number; dealerName?: string; submittedAt?: string }

const shortDate = (value: string) => new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

/* --------------------------------------------------------------- Admin Users */
interface AdminUserRow { id: string; email: string; status: string; createdAt: string }
export function AdminUsersSection() {
	const { data, status, error: loadError, reload } = useAdminSection<{ users: AdminUserRow[] }>("/api/admin/users");
	const [email, setEmail] = useState("");
	const [creating, setCreating] = useState(false);
	const [created, setCreated] = useState<string | null>(null);
	const [error, setError] = useState("");
	// Which user row has a status change in flight, so only that row's button goes busy.
	const [busyUserId, setBusyUserId] = useState<string | null>(null);
	const users = data?.users ?? [];

	async function addAdmin() {
		setError(""); setCreating(true); setCreated(null);
		try {
			const body = await post<{ email?: string }>("/api/admin/users", { email }, "Admin account could not be created");
			setCreated(body.email!);
			setEmail("");
			reload();
		} catch (caught) { setError(caught instanceof Error ? caught.message : "Admin account could not be created"); }
		finally { setCreating(false); }
	}

	async function setUserStatus(id: string, nextStatus: "ACTIVE" | "INACTIVE") {
		setError(""); setBusyUserId(id);
		try {
			await post(`/api/admin/users/${id}/status`, { status: nextStatus }, "Admin account could not be updated");
			reload();
		} catch (caught) { setError(caught instanceof Error ? caught.message : "Admin account could not be updated"); }
		finally { setBusyUserId(null); }
	}

	return <>
		<PageHead eyebrow="Team access" title="Admin Users" lead="Every KITCO admin has their own login. No shared passwords." />
		<section className="panel">
			<div className="panel-head"><h3>Add admin</h3></div>
			<div className="panel-body">
				<FormField label="Email" htmlFor="new-admin-email">
					<Input id="new-admin-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@kitco.example" />
				</FormField>
				<Button disabled={!email || creating} loading={creating} onClick={() => void addAdmin()}>{creating ? "Creating…" : "Create admin account"}</Button>
				{created && <p className="notice">Account created for {created}. They'll sign in with their email and a one-time code — no password needed.</p>}
				{error && <p className="form-error" role="alert">{error}</p>}
			</div>
		</section>
		{status !== "ready" ? <SectionState status={status} error={loadError} retry={reload} /> : users.length === 0
			? <SectionState status="ready" retry={reload} empty="No admin accounts yet." />
			: <section className="panel">
				<div className="panel-head"><h3>{users.length} admin accounts</h3></div>
				<div className="table-wrap"><table className="data-table">
					<thead><tr><th>Email</th><th>Status</th><th>Created</th><th /></tr></thead>
					<tbody>{users.map((user) => <tr key={user.id}>
						<td><b>{user.email}</b></td>
						<td><StatusPill value={user.status} /></td>
						<td>{shortDate(user.createdAt)}</td>
						<td className="right">{user.status === "ACTIVE"
							? <Button variant="secondary" size="sm" loading={busyUserId === user.id} disabled={busyUserId === user.id} onClick={() => void setUserStatus(user.id, "INACTIVE")}>Deactivate</Button>
							: <Button variant="secondary" size="sm" loading={busyUserId === user.id} disabled={busyUserId === user.id} onClick={() => void setUserStatus(user.id, "ACTIVE")}>Reactivate</Button>}</td>
					</tr>)}</tbody>
				</table></div>
			</section>}
	</>;
}

const number = (value: number) => value.toLocaleString("en-IN");

/* ------------------------------------------------------------ Dealer Applications */
interface DealerApplicationRow { id: string; businessName: string; gstin: string; city: string; state: string; contactPerson: string; primaryEmail: string; secondaryEmail: string | null; mobile: string; status: string; reviewNotes: string | null; createdAt: string }
export function DealerApplicationsSection() {
	const { data, status, error: loadError, reload } = useAdminSection<{ applications: DealerApplicationRow[] }>("/api/admin/dealer-applications");
	const [openId, setOpenId] = useState<string | null>(null);
	const [notes, setNotes] = useState("");
	const [busy, setBusy] = useState<"approve" | "reject" | "request-more-info" | null>(null);
	const [error, setError] = useState("");
	const [query, setQuery] = useState("");
	const allApplications = data?.applications ?? [];
	const needle = query.trim().toLowerCase();
	// Client-side only: the list is a few hundred rows at most, never paginated.
	const applications = needle
		? allApplications.filter((item) => [item.businessName, item.city, item.state, item.contactPerson, item.gstin, item.primaryEmail]
			.some((field) => field?.toLowerCase().includes(needle)))
		: allApplications;
	const open = allApplications.find((item) => item.id === openId);
	const reviewable = new Set(["SUBMITTED", "UNDER_REVIEW", "MORE_INFO_REQUIRED"]);

	async function decide(action: "approve" | "reject" | "request-more-info") {
		if (!open) return;
		setError(""); setBusy(action);
		try {
			await post(`/api/admin/dealer-applications/${open.id}/${action}`, action === "approve" ? undefined : { notes }, "Application could not be updated");
			setOpenId(null); setNotes(""); reload();
		} catch (caught) { setError(caught instanceof Error ? caught.message : "Application could not be updated"); }
		finally { setBusy(null); }
	}

	if (open) return <>
		<PageHead eyebrow="New dealer registration" title={open.businessName} actions={<Button variant="secondary" onClick={() => setOpenId(null)}>Back to applications</Button>} />
		<section className="panel"><div className="panel-body">
			<dl className="control-detail-grid">
				<div><dt>GSTIN</dt><dd>{open.gstin}</dd></div>
				<div><dt>Location</dt><dd>{open.city}, {open.state}</dd></div>
				<div><dt>Contact person</dt><dd>{open.contactPerson}</dd></div>
				<div><dt>Primary email</dt><dd>{open.primaryEmail}</dd></div>
				<div><dt>Secondary email</dt><dd>{open.secondaryEmail ?? "—"}</dd></div>
				<div><dt>Mobile</dt><dd>{open.mobile}</dd></div>
				<div><dt>Submitted</dt><dd>{shortDate(open.createdAt)}</dd></div>
				<div><dt>Status</dt><dd><StatusPill value={open.status} /></dd></div>
			</dl>
			{open.reviewNotes && <p className="notice">Previous review note: {open.reviewNotes}</p>}
			{reviewable.has(open.status) && <>
				<FormField label="Notes (required to reject or ask for more info)" htmlFor="app-notes"><Input id="app-notes" value={notes} onChange={(event) => setNotes(event.target.value)} /></FormField>
				<div className="control-actions-row">
					<Button onClick={() => void decide("approve")} loading={busy === "approve"} disabled={busy !== null}>{busy === "approve" ? "Approving…" : "Approve and create dealer"}</Button>
					<Button variant="secondary" onClick={() => void decide("request-more-info")} loading={busy === "request-more-info"} disabled={busy !== null || !notes}>{busy === "request-more-info" ? "Sending…" : "Request more info"}</Button>
					<Button variant="secondary" onClick={() => void decide("reject")} loading={busy === "reject"} disabled={busy !== null || !notes}>{busy === "reject" ? "Rejecting…" : "Reject"}</Button>
				</div>
			</>}
			{error && <p className="form-error" role="alert">{error}</p>}
		</div></section>
	</>;

	return <>
		<PageHead eyebrow="New dealer registration" title="Dealer Applications" lead="New dealers who aren't in our system yet can sign up here during the pilot. This is the list of who's applied." />
		{status !== "ready" ? <SectionState status={status} error={loadError} retry={reload} /> : allApplications.length === 0
			? <SectionState status="ready" retry={reload} empty="No dealer applications yet." />
			: <section className="panel">
				<div className="panel-head">
					<h3>{applications.length.toLocaleString("en-IN")}{applications.length !== allApplications.length ? ` of ${allApplications.length.toLocaleString("en-IN")}` : ""} applications</h3>
					<SearchField label="Search dealer applications" style={{ minWidth: 220 }} placeholder="Search business, city, contact or GSTIN" value={query} onChange={(event) => setQuery(event.target.value)} />
				</div>
				{applications.length === 0 ? <div className="empty"><h3>No matching applications</h3><p>Try a different search.</p></div> : <div className="table-wrap"><table className="data-table">
					<thead><tr><th>Business</th><th>City</th><th>Contact</th><th>Submitted</th><th>Status</th><th /></tr></thead>
					<tbody>{applications.map((item) => <tr key={item.id}>
						<td><b>{item.businessName}</b></td>
						<td>{item.city}</td>
						<td>{item.contactPerson}</td>
						<td>{shortDate(item.createdAt)}</td>
						<td><StatusPill value={item.status} /></td>
						<td className="right"><Button variant="secondary" size="sm" onClick={() => setOpenId(item.id)}>Review</Button></td>
					</tr>)}</tbody>
				</table></div>}
			</section>}
	</>;
}

/* ------------------------------------------------------------------- Orders */
/** Adds the dealer identity/location fields the orders list already returns (see
 *  SupabaseCommerceRepository.orderFromRow) but LiveOrder doesn't declare. */
type QueueOrder = LiveOrder & { dealerId?: string; dealerCity?: string; dealerState?: string };

export function OrdersSection() {
	const { data, status, error, reload } = useAdminSection<{ orders: QueueOrder[] }>("/api/admin/orders");
	const [openOrderId, setOpenOrderId] = useState<string | null>(null);
	const [statusFilter, setStatusFilter] = useState("");
	const [dealerFilter, setDealerFilter] = useState("");
	const [stateFilter, setStateFilter] = useState("");
	const [dateFrom, setDateFrom] = useState("");
	const [dateTo, setDateTo] = useState("");
	const [query, setQuery] = useState("");
	const orders = (data?.orders ?? []).map((order) => ({ ...order, allocations: order.allocations ?? [], audit: order.audit ?? [] }));
	const open = orders.find((order) => order.id === openOrderId);
	const statuses = [...new Set(orders.map((order) => order.status))];
	const dealers = [...new Map(orders.filter((order) => order.dealerId).map((order) => [order.dealerId as string, order.dealerName ?? order.dealerId as string])).entries()];
	const states = [...new Set(orders.map((order) => order.dealerState).filter((value): value is string => Boolean(value)))];
	const needle = query.trim().toLowerCase();
	const rows = orders.filter((order) =>
		(!statusFilter || order.status === statusFilter)
		&& (!dealerFilter || order.dealerId === dealerFilter)
		&& (!stateFilter || order.dealerState === stateFilter)
		&& (!dateFrom || (order.submittedAt ?? "").slice(0, 10) >= dateFrom)
		&& (!dateTo || (order.submittedAt ?? "").slice(0, 10) <= dateTo)
		// Client-side only, on top of the structured filters above -- the export endpoint has
		// no free-text param, so this never reaches exportParams below.
		&& (!needle || `${order.orderNumber ?? ""} ${order.dealerName ?? ""}`.toLowerCase().includes(needle)));
	const exportParams = new URLSearchParams();
	if (statusFilter) exportParams.set("orderStatus", statusFilter);
	if (dealerFilter) exportParams.set("dealerId", dealerFilter);
	if (stateFilter) exportParams.set("state", stateFilter);
	if (dateFrom) exportParams.set("dateFrom", dateFrom);
	if (dateTo) exportParams.set("dateTo", dateTo);
	const exportQuery = exportParams.toString();
	const exportHref = `/api/admin/orders/export-products.csv${exportQuery ? `?${exportQuery}` : ""}`;

	if (open) return <>
		<PageHead eyebrow="Order governance" title="Order review" actions={<div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
			<a className="ui-btn ui-btn-secondary ui-btn-md" href={`/api/admin/orders/${open.id}/export-products.csv`}>Download this order</a>
			<Button variant="secondary" onClick={() => { setOpenOrderId(null); reload(); }}>Back to all orders</Button>
		</div>} />
		<AdminOrderPanel orderId={open.id} />
	</>;

	return <>
		<PageHead eyebrow="Order governance" title="Orders" lead="Review dealer submissions, approve, revise and maintain the audit trail." />
		{status !== "ready" ? <SectionState status={status} error={error} retry={reload} /> : orders.length === 0
			? <SectionState status="ready" retry={reload} empty="No dealer orders have been submitted yet." />
			: <section className="panel">
				<div className="panel-head">
					<h3>{number(rows.length)} orders</h3>
					<div className="control-filter-row">
						<Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search order no. or dealer" aria-label="Search order number or dealer" />
						<Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by status">
							<option value="">All statuses</option>
							{statuses.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
						</Select>
						<Select value={dealerFilter} onChange={(event) => setDealerFilter(event.target.value)} aria-label="Filter by dealer">
							<option value="">All dealers</option>
							{dealers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
						</Select>
						<Select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} aria-label="Filter by state">
							<option value="">All states</option>
							{states.map((value) => <option key={value} value={value}>{value}</option>)}
						</Select>
						<Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="Submitted from date" />
						<Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label="Submitted to date" />
						<a className="ui-btn ui-btn-secondary ui-btn-md" href={exportHref}>Download order summary</a>
					</div>
				</div>
				<OrdersTable orders={rows} variant="admin" onReview={setOpenOrderId} />
			</section>}
	</>;
}

/* ------------------------------------------------------------------ Reports */
/** Adds the dealer identity/state fields the orders list already returns (see
 *  SupabaseCommerceRepository.orderFromRow) but LiveOrder doesn't declare. */
type ReportOrder = LiveOrder & { dealerId?: string; dealerState?: string };

export function ReportsSection() {
	const { data, status, error, reload } = useAdminSection<{ orders: ReportOrder[] }>("/api/admin/orders");
	const [statusFilter, setStatusFilter] = useState("");
	const [dealerFilter, setDealerFilter] = useState("");
	const [brandFilter, setBrandFilter] = useState("");
	const [stateFilter, setStateFilter] = useState("");
	const [holdStatusFilter, setHoldStatusFilter] = useState("");
	const [dateFrom, setDateFrom] = useState("");
	const [dateTo, setDateTo] = useState("");
	const [query, setQuery] = useState("");
	const orders = data?.orders ?? [];
	const statuses = [...new Set(orders.map((order) => order.status))];
	const dealers = [...new Map(orders.filter((order) => order.dealerId).map((order) => [order.dealerId as string, order.dealerName ?? order.dealerId as string])).entries()];
	const brands = [...new Set(orders.flatMap((order) => (order.allocations ?? []).map((item) => item.brand)).filter((value): value is string => Boolean(value)))];
	const states = [...new Set(orders.map((order) => order.dealerState).filter((value): value is string => Boolean(value)))];
	const needle = query.trim().toLowerCase();
	const rows = orders.filter((order) =>
		(!statusFilter || order.status === statusFilter)
		&& (!dealerFilter || order.dealerId === dealerFilter)
		&& (!brandFilter || (order.allocations ?? []).some((item) => item.brand === brandFilter))
		&& (!stateFilter || order.dealerState === stateFilter)
		&& (!dateFrom || (order.submittedAt ?? "").slice(0, 10) >= dateFrom)
		&& (!dateTo || (order.submittedAt ?? "").slice(0, 10) <= dateTo)
		// Client-side only, on top of the structured filters above -- the export endpoint has
		// no free-text param, so this never reaches exportParams below.
		&& (!needle || `${order.orderNumber ?? ""} ${order.dealerName ?? ""}`.toLowerCase().includes(needle)));
	const totalValue = rows.reduce((sum, order) => sum + (order.retailValueMinor ?? 0), 0);
	const totalPairs = rows.reduce((sum, order) => sum + (order.allocations ?? []).reduce((lines, item) => lines + item.approvedPairs, 0), 0);

	// Hold status has no reliable per-order signal in this list payload (only active-hold pairs
	// are surfaced, not a released/none distinction), so it drives the CSV export's real SQL
	// filter only -- it's deliberately left out of the on-screen `rows` filter above rather than
	// faking a match against data that can't actually answer it.
	const exportParams = new URLSearchParams();
	if (statusFilter) exportParams.set("orderStatus", statusFilter);
	if (dealerFilter) exportParams.set("dealerId", dealerFilter);
	if (brandFilter) exportParams.set("brand", brandFilter);
	if (stateFilter) exportParams.set("state", stateFilter);
	if (holdStatusFilter) exportParams.set("holdStatus", holdStatusFilter);
	if (dateFrom) exportParams.set("dateFrom", dateFrom);
	if (dateTo) exportParams.set("dateTo", dateTo);
	const exportQuery = exportParams.toString();
	const exportHref = `/api/admin/orders/export.csv${exportQuery ? `?${exportQuery}` : ""}`;

	return <>
		<PageHead eyebrow="Reports" title="Reports" lead="Filter your orders and export what you need. Retail value only — dealer pricing terms aren't tracked here." actions={<a className="ui-btn ui-btn-primary ui-btn-md" href={exportHref}>Export CSV</a>} />
		{status !== "ready" ? <SectionState status={status} error={error} retry={reload} /> : orders.length === 0
			? <SectionState status="ready" retry={reload} empty="No orders to report on yet." />
			: <>
				<div className="stat-grid">
					<div className="stat"><div className="k">Orders</div><div className="v">{number(rows.length)}</div></div>
					<div className="stat"><div className="k">Retail Value</div><div className="v">{formatRetailValue(totalValue)}</div></div>
					<div className="stat"><div className="k">Approved Pairs</div><div className="v">{number(totalPairs)}</div></div>
					<div className="stat"><div className="k">Status types</div><div className="v">{number(statuses.length)}</div></div>
				</div>
				<section className="panel">
					<div className="panel-head">
						<h3>Order list</h3>
						<div className="control-filter-row">
							<Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search order no. or dealer" aria-label="Search order number or dealer" />
							<Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by status">
								<option value="">All statuses</option>
								{statuses.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
							</Select>
							<Select value={dealerFilter} onChange={(event) => setDealerFilter(event.target.value)} aria-label="Filter by dealer">
								<option value="">All dealers</option>
								{dealers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
							</Select>
							<Select value={brandFilter} onChange={(event) => setBrandFilter(event.target.value)} aria-label="Filter by brand">
								<option value="">All brands</option>
								{brands.map((value) => <option key={value} value={value}>{value}</option>)}
							</Select>
							<Select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} aria-label="Filter by state">
								<option value="">All states</option>
								{states.map((value) => <option key={value} value={value}>{value}</option>)}
							</Select>
							<Select value={holdStatusFilter} onChange={(event) => setHoldStatusFilter(event.target.value)} aria-label="Filter by hold status (applies to CSV export)">
								<option value="">All hold statuses</option>
								<option value="ACTIVE">Active hold</option>
								<option value="RELEASED">Released hold</option>
							</Select>
							<Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="Submitted from date" />
							<Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label="Submitted to date" />
						</div>
					</div>
					<div className="table-wrap"><table className="data-table">
						<thead><tr><th>Dealer</th><th>Order</th><th>Version</th><th>Line items</th><th>Retail Value</th><th>Status</th></tr></thead>
						<tbody>{rows.map((order) => <tr key={order.id}>
							<td><b>{order.dealerName ?? "—"}</b></td>
							<td>{order.orderNumber ?? order.id.slice(0, 8)}</td>
							<td>V{order.version ?? 1}</td>
							<td>{number((order.allocations ?? []).length)}</td>
							<td>{typeof order.retailValueMinor === "number" ? formatRetailValue(order.retailValueMinor) : "—"}</td>
							<td><StatusPill value={order.status} /></td>
						</tr>)}</tbody>
					</table></div>
				</section>
			</>}
	</>;
}

/* ------------------------------------------------------------------- Shell */
const sections = [
	{ slug: "", label: "Dashboard", group: "primary", render: () => <DashboardSection /> },
	{ slug: "orders", label: "Orders", group: "primary", render: () => <OrdersSection /> },
	{ slug: "dispatch", label: "Dispatch", group: "primary", render: () => <DispatchSection /> },
	{ slug: "credit-holds", label: "Credit Holds", group: "primary", render: () => <HoldsSection /> },
	{ slug: "dealers", label: "Dealers", group: "primary", render: () => <DealersSection /> },
	{ slug: "dealer-onboarding", label: "Dealer Onboarding", group: "primary", render: () => <DealerOnboardingSection /> },
	{ slug: "dealer-applications", label: "Dealer Applications", group: "primary", render: () => <DealerApplicationsSection /> },
	{ slug: "dealer-groups", label: "Dealer Groups", group: "primary", render: () => <DealerGroupsSection /> },
	{ slug: "group-requests", label: "Group Requests", group: "primary", render: () => <GroupRequestsSection /> },
	{ slug: "dealer-import", label: "Dealer Import", group: "operations", render: () => <DealerImportSection /> },
	{ slug: "gst-registrations", label: "GST Registrations", group: "operations", render: () => <GstRegistrationsSection /> },
	{ slug: "catalogue", label: "Catalogue", group: "primary", render: () => <CatalogueSection /> },
	{ slug: "catalogue-imports", label: "Catalogue Imports", group: "operations", render: () => <ImportsSection /> },
	{ slug: "media-library", label: "Media Library", group: "operations", render: () => <MediaSection /> },
	{ slug: "size-sets", label: "Size Sets", group: "operations", render: () => <SizeSetsSection /> },
	{ slug: "commercial-offerings", label: "Offerings", group: "operations", render: () => <OfferingsSection /> },
	{ slug: "seasons", label: "Seasons", group: "operations", render: () => <SeasonsSection /> },
	{ slug: "schemes", label: "Schemes", group: "operations", render: () => <SchemesSection /> },
	{ slug: "reports", label: "Reports", group: "operations", render: () => <ReportsSection /> },
	{ slug: "audit-trail", label: "Audit Trail", group: "operations", render: () => <AuditSection /> },
	{ slug: "admin-users", label: "Admin Users", group: "operations", render: () => <AdminUsersSection /> },
	{ slug: "settings", label: "Settings", group: "operations", render: () => <SettingsSection /> },
] as const;

function currentSlug(pathname: string): string {
	const rest = pathname.replace(/^\/control\/?/, "").replace(/\/$/, "");
	return sections.some((section) => section.slug === rest) ? rest : "";
}

export function ControlConsole() {
	const [slug, setSlug] = useState(() => currentSlug(window.location.pathname));
	useEffect(() => {
		const update = () => setSlug(currentSlug(window.location.pathname));
		window.addEventListener("popstate", update);
		return () => window.removeEventListener("popstate", update);
	}, []);

	function navigate(target: string) {
		window.history.pushState({}, "", target ? `/control/${target}` : "/control");
		setSlug(target);
	}

	const active = sections.find((section) => section.slug === slug) ?? sections[0];
	const link = (section: (typeof sections)[number]) => <a
		key={section.slug || "dashboard"}
		href={section.slug ? `/control/${section.slug}` : "/control"}
		className={section.slug === active.slug ? "is-active" : undefined}
		aria-current={section.slug === active.slug ? "page" : undefined}
		onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey) return; event.preventDefault(); navigate(section.slug); }}
	>{section.label}</a>;

	return <div className="control-layout">
		<aside className="control-nav">
			<p>KITCO Control</p>
			<nav aria-label="KITCO Control navigation">
				{sections.filter((section) => section.group === "primary").map(link)}
				<span>Operations</span>
				{sections.filter((section) => section.group === "operations").map(link)}
			</nav>
		</aside>
		<main className="control-main">{active.render()}</main>
	</div>;
}
