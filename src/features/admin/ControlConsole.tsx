import { useEffect, useState } from "react";
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

const number = (value: number) => value.toLocaleString("en-IN");

/* ------------------------------------------------------------------- Orders */
function OrdersSection() {
	const { data, status, reload } = useAdminSection<{ orders: LiveOrder[] }>("/api/admin/orders");
	const [openOrderId, setOpenOrderId] = useState<string | null>(null);
	const orders = (data?.orders ?? []).map((order) => ({ ...order, allocations: order.allocations ?? [], audit: order.audit ?? [] }));
	const open = orders.find((order) => order.id === openOrderId);

	if (open) return <>
		<PageHead eyebrow="Order governance" title="Order review" actions={<button className="btn secondary" type="button" onClick={() => setOpenOrderId(null)}>Back to all orders</button>} />
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
						<td className="right"><button className="btn small secondary" type="button" onClick={() => setOpenOrderId(order.id)}>Review</button></td>
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
		<PageHead eyebrow="Flexible reporting" title="Reports" lead="Filter the live order book. Retail Value only — dealer terms sit outside the platform." />
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
						<select className="chip" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by status">
							<option value="">All statuses</option>
							{statuses.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
						</select>
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
	{ slug: "catalogue", label: "Catalogue", group: "primary", render: () => <CatalogueSection /> },
	{ slug: "catalogue-imports", label: "Catalogue Imports", group: "operations", render: () => <ImportsSection /> },
	{ slug: "media-library", label: "Media Library", group: "operations", render: () => <MediaSection /> },
	{ slug: "size-sets", label: "Size Sets", group: "operations", render: () => <SizeSetsSection /> },
	{ slug: "commercial-offerings", label: "Commercial Offerings", group: "operations", render: () => <OfferingsSection /> },
	{ slug: "seasons", label: "Seasons", group: "operations", render: () => <SeasonsSection /> },
	{ slug: "schemes", label: "Schemes", group: "operations", render: () => <SchemesSection /> },
	{ slug: "reports", label: "Reports", group: "operations", render: () => <ReportsSection /> },
	{ slug: "audit-trail", label: "Audit Trail", group: "operations", render: () => <AuditSection /> },
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
