import { useEffect, useState } from "react";
import { Button, FormField, Input, Select } from "../../components/ui";
import { formatRetailValue } from "../catalogue/types";
import { AdminOrderPanel, type ControlOrder } from "./AdminOrderPanel";
import {
	AuditSection, CatalogueSection, DashboardSection, DealersSection, DispatchSection,
	HoldsSection, ImportsSection, MediaSection, OfferingsSection, PageHead, SchemesSection,
	SeasonsSection, SectionState, SettingsSection, SizeSetsSection, StatusPill,
} from "./ControlSections";
import { useAdminSection } from "./useAdminSection";
import "./control.css";

interface LiveOrder extends ControlOrder { version?: number; retailValueMinor?: number; dealerName?: string; submittedAt?: string }

const shortDate = (value: string) => new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

/* --------------------------------------------------------------- Admin Users */
interface AdminUserRow { id: string; email: string; status: string; createdAt: string }
function AdminUsersSection() {
	const { data, status, reload } = useAdminSection<{ users: AdminUserRow[] }>("/api/admin/users");
	const [email, setEmail] = useState("");
	const [creating, setCreating] = useState(false);
	const [created, setCreated] = useState<string | null>(null);
	const [error, setError] = useState("");
	const users = data?.users ?? [];

	async function addAdmin() {
		setError(""); setCreating(true); setCreated(null);
		try {
			const response = await fetch("/api/admin/users", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
			const body = await response.json() as { email?: string; error?: { message?: string } };
			if (!response.ok) throw new Error(body.error?.message ?? "Admin account could not be created");
			setCreated(body.email!);
			setEmail("");
			reload();
		} catch (caught) { setError(caught instanceof Error ? caught.message : "Admin account could not be created"); }
		finally { setCreating(false); }
	}

	async function setUserStatus(id: string, nextStatus: "ACTIVE" | "INACTIVE") {
		setError("");
		try {
			const response = await fetch(`/api/admin/users/${id}/status`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: nextStatus }) });
			const body = await response.json() as { error?: { message?: string } };
			if (!response.ok) throw new Error(body.error?.message ?? "Admin account could not be updated");
			reload();
		} catch (caught) { setError(caught instanceof Error ? caught.message : "Admin account could not be updated"); }
	}

	return <>
		<PageHead eyebrow="Access control" title="Admin Users" lead="Every KITCO admin signs in with their own account. No shared credentials." />
		<section className="panel">
			<div className="panel-head"><h3>Add admin</h3></div>
			<div className="panel-body">
				<FormField label="Email" htmlFor="new-admin-email">
					<Input id="new-admin-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@kitco.example" />
				</FormField>
				<Button disabled={!email || creating} onClick={() => void addAdmin()}>{creating ? "Creating…" : "Create admin account"}</Button>
				{created && <p className="notice">Account created for {created}. They sign in with email + a one-time code -- no password.</p>}
				{error && <p className="form-error" role="alert">{error}</p>}
			</div>
		</section>
		{status !== "ready" ? <SectionState status={status} retry={reload} /> : users.length === 0
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
							? <Button variant="secondary" size="sm" onClick={() => void setUserStatus(user.id, "INACTIVE")}>Deactivate</Button>
							: <Button variant="secondary" size="sm" onClick={() => void setUserStatus(user.id, "ACTIVE")}>Reactivate</Button>}</td>
					</tr>)}</tbody>
				</table></div>
			</section>}
	</>;
}

const number = (value: number) => value.toLocaleString("en-IN");

/* ------------------------------------------------------------ Dealer Applications */
interface DealerApplicationRow { id: string; businessName: string; gstin: string; city: string; state: string; contactPerson: string; primaryEmail: string; secondaryEmail: string | null; mobile: string; status: string; reviewNotes: string | null; createdAt: string }
function DealerApplicationsSection() {
	const { data, status, reload } = useAdminSection<{ applications: DealerApplicationRow[] }>("/api/admin/dealer-applications");
	const [openId, setOpenId] = useState<string | null>(null);
	const [notes, setNotes] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const applications = data?.applications ?? [];
	const open = applications.find((item) => item.id === openId);
	const reviewable = new Set(["SUBMITTED", "UNDER_REVIEW", "MORE_INFO_REQUIRED"]);

	async function decide(action: "approve" | "reject" | "request-more-info") {
		if (!open) return;
		setError(""); setBusy(true);
		try {
			const response = await fetch(`/api/admin/dealer-applications/${open.id}/${action}`, {
				method: "POST", credentials: "include", headers: { "content-type": "application/json" },
				body: action === "approve" ? undefined : JSON.stringify({ notes }),
			});
			const body = await response.json() as { error?: string };
			if (!response.ok) throw new Error(body.error ?? "Application could not be updated");
			setOpenId(null); setNotes(""); reload();
		} catch (caught) { setError(caught instanceof Error ? caught.message : "Application could not be updated"); }
		finally { setBusy(false); }
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
				<FormField label="Review notes (required to reject or request more info)" htmlFor="app-notes"><Input id="app-notes" value={notes} onChange={(event) => setNotes(event.target.value)} /></FormField>
				<div className="control-actions-row">
					<Button onClick={() => void decide("approve")} disabled={busy}>{busy ? "Working…" : "Approve · create dealer"}</Button>
					<Button variant="secondary" onClick={() => void decide("request-more-info")} disabled={busy || !notes}>Request more info</Button>
					<Button variant="secondary" onClick={() => void decide("reject")} disabled={busy || !notes}>Reject</Button>
				</div>
			</>}
			{error && <p className="form-error" role="alert">{error}</p>}
		</div></section>
	</>;

	return <>
		<PageHead eyebrow="New dealer registration" title="Dealer Applications" lead="Review applications from dealers KITCO doesn't have on file yet." />
		{status !== "ready" ? <SectionState status={status} retry={reload} /> : applications.length === 0
			? <SectionState status="ready" retry={reload} empty="No dealer applications yet." />
			: <section className="panel">
				<div className="panel-head"><h3>{applications.length} applications</h3></div>
				<div className="table-wrap"><table className="data-table">
					<thead><tr><th>Business</th><th>City</th><th>Contact</th><th>Submitted</th><th>Status</th><th /></tr></thead>
					<tbody>{applications.map((item) => <tr key={item.id}>
						<td><b>{item.businessName}</b></td>
						<td>{item.city}</td>
						<td>{item.contactPerson}</td>
						<td>{shortDate(item.createdAt)}</td>
						<td><StatusPill value={item.status} /></td>
						<td className="right"><Button variant="secondary" size="sm" onClick={() => setOpenId(item.id)}>Review</Button></td>
					</tr>)}</tbody>
				</table></div>
			</section>}
	</>;
}

/* ------------------------------------------------------------------- Orders */
function OrdersSection() {
	const { data, status, reload } = useAdminSection<{ orders: LiveOrder[] }>("/api/admin/orders");
	const [openOrderId, setOpenOrderId] = useState<string | null>(null);
	const orders = (data?.orders ?? []).map((order) => ({ ...order, allocations: order.allocations ?? [], audit: order.audit ?? [] }));
	const open = orders.find((order) => order.id === openOrderId);

	if (open) return <>
		<PageHead eyebrow="Order governance" title="Order review" actions={<Button variant="secondary" onClick={() => setOpenOrderId(null)}>Back to all orders</Button>} />
		<AdminOrderPanel order={open} />
	</>;

	return <>
		<PageHead eyebrow="Order governance" title="Orders" lead="Review dealer submissions, approve, revise and maintain the audit trail." />
		{status !== "ready" ? <SectionState status={status} retry={reload} /> : orders.length === 0
			? <SectionState status="ready" retry={reload} empty="No dealer orders have been submitted yet." />
			: <section className="panel">
				<div className="panel-head"><h3>{number(orders.length)} orders</h3></div>
				<div className="table-wrap"><table className="data-table">
					<thead><tr><th>Order</th><th>Version</th><th>Lines</th><th>Retail Value</th><th>Status</th><th /></tr></thead>
					<tbody>{orders.map((order) => <tr key={order.id}>
						<td><b>{order.id.slice(0, 8)}</b></td>
						<td>V{order.version ?? 1}</td>
						<td>{number(order.allocations.length)}</td>
						<td>{typeof order.retailValueMinor === "number" ? formatRetailValue(order.retailValueMinor) : "—"}</td>
						<td><StatusPill value={order.status} /></td>
						<td className="right"><Button variant="secondary" size="sm" onClick={() => setOpenOrderId(order.id)}>Review</Button></td>
					</tr>)}</tbody>
				</table></div>
			</section>}
	</>;
}

/* ------------------------------------------------------------------ Reports */
function ReportsSection() {
	const { data, status, reload } = useAdminSection<{ orders: LiveOrder[] }>("/api/admin/orders");
	const [statusFilter, setStatusFilter] = useState("");
	const orders = data?.orders ?? [];
	const statuses = [...new Set(orders.map((order) => order.status))];
	const rows = orders.filter((order) => !statusFilter || order.status === statusFilter);
	const totalValue = rows.reduce((sum, order) => sum + (order.retailValueMinor ?? 0), 0);
	const totalPairs = rows.reduce((sum, order) => sum + (order.allocations ?? []).reduce((lines, item) => lines + item.approvedPairs, 0), 0);

	return <>
		<PageHead eyebrow="Flexible reporting" title="Reports" lead="Filter the live order book. Retail Value only — dealer terms sit outside the platform." actions={<a className="ui-btn ui-btn-primary ui-btn-md" href="/api/admin/orders/export.csv">Export CSV</a>} />
		{status !== "ready" ? <SectionState status={status} retry={reload} /> : orders.length === 0
			? <SectionState status="ready" retry={reload} empty="No orders exist to report on yet." />
			: <>
				<div className="stat-grid">
					<div className="stat"><div className="k">Orders</div><div className="v">{number(rows.length)}</div></div>
					<div className="stat"><div className="k">Retail Value</div><div className="v">{formatRetailValue(totalValue)}</div></div>
					<div className="stat"><div className="k">Approved Pairs</div><div className="v">{number(totalPairs)}</div></div>
					<div className="stat"><div className="k">Statuses</div><div className="v">{number(statuses.length)}</div></div>
				</div>
				<section className="panel">
					<div className="panel-head">
						<h3>Order register</h3>
						<Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by status">
							<option value="">All statuses</option>
							{statuses.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
						</Select>
					</div>
					<div className="table-wrap"><table className="data-table">
						<thead><tr><th>Order</th><th>Version</th><th>Lines</th><th>Retail Value</th><th>Status</th></tr></thead>
						<tbody>{rows.map((order) => <tr key={order.id}>
							<td><b>{order.id.slice(0, 8)}</b></td>
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
	{ slug: "dealer-applications", label: "Dealer Applications", group: "primary", render: () => <DealerApplicationsSection /> },
	{ slug: "catalogue", label: "Catalogue", group: "primary", render: () => <CatalogueSection /> },
	{ slug: "catalogue-imports", label: "Catalogue Imports", group: "operations", render: () => <ImportsSection /> },
	{ slug: "media-library", label: "Media Library", group: "operations", render: () => <MediaSection /> },
	{ slug: "size-sets", label: "Size Sets", group: "operations", render: () => <SizeSetsSection /> },
	{ slug: "commercial-offerings", label: "Commercial Offerings", group: "operations", render: () => <OfferingsSection /> },
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
