import { useState } from "react";
import { Button, Checkbox, FormField, Input, SearchField } from "../../components/ui";
import { PageHead, SectionState, StatusPill } from "./ControlSections";
import { post, type AdminDealerRow } from "./DealerOnboarding";
import { useAdminSection } from "./useAdminSection";

interface AdminDealerGroupRow {
	id: string;
	groupCode: string;
	groupName: string;
	status: string;
	primaryDealerId: string | null;
	dealerCount: number;
}

interface MembershipRequestRow {
	id: string;
	dealerId: string;
	dealerCode: string;
	dealerName: string;
	requestedGroupCode: string;
	status: string;
	requestedAt: string;
	decidedAt: string | null;
	decisionNotes: string | null;
}

interface GstRegistrationRow {
	id: string;
	gstin: string;
	legalName: string | null;
	tradeName: string | null;
	state: string | null;
	gstStatus: string | null;
	verificationStatus: string;
	verifiedAt: string | null;
	provider: string | null;
	dealers: { dealerId: string; dealerCode: string; displayName: string; city: string | null; state: string | null; isMainDealer: boolean }[];
}

const dash = "—";
const count = (value: number) => value.toLocaleString("en-IN");
const shortDate = (value: string | null) => value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : dash;

/* ------------------------------------------------------------ Verification badge */
/** Word plus icon, never colour on its own, and never a tick for anything but a live
 *  provider response. NOT_LIVE_VERIFIED is mock evidence: it renders as *unverified
 *  with a reason* (V5_GST_INTEGRATION.md §3), never as a shortcut to verified. */
function VerificationBadge({ status, verifiedAt, provider }: { status: string; verifiedAt: string | null; provider: string | null }) {
	const verified = status === "VERIFIED";
	const failed = status === "FAILED";
	const word = verified ? "Verified" : failed ? "Verification failed" : "Not verified";
	const detail = verified
		? [provider, verifiedAt ? shortDate(verifiedAt) : null].filter(Boolean).join(" · ")
		: status === "NOT_LIVE_VERIFIED" ? "No GST connection configured"
			: status === "UNVERIFIED" || failed ? "" : `Status on file: ${status.replaceAll("_", " ")}`;

	return <span className={`verify${verified ? " is-verified" : ""}`}>
		<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.4" />
			{verified
				? <path d="M5 8.2 7.1 10.3 11 6.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
				: failed
					? <path d="M8 4.6v4.2M8 11.1v.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
					: <path d="M5.2 8h5.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
		</svg>
		<span>{word}{detail && <span className="verify-detail"> — {detail}</span>}</span>
	</span>;
}

/* ------------------------------------------------------------------ Group detail */
function GroupDetail({ group, dealers, onBack, reload }: {
	group: AdminDealerGroupRow;
	dealers: AdminDealerRow[];
	onBack: () => void;
	reload: () => void;
}) {
	const [groupName, setGroupName] = useState(group.groupName);
	const [renaming, setRenaming] = useState(false);
	const [dealerCode, setDealerCode] = useState("");
	const [asMainDealer, setAsMainDealer] = useState(false);
	const [adding, setAdding] = useState(false);
	const [error, setError] = useState("");
	const [message, setMessage] = useState("");

	const members = dealers.filter((dealer) => dealer.groupCode === group.groupCode);
	const renamed = groupName.trim() !== group.groupName && groupName.trim().length >= 2;

	async function rename() {
		setError(""); setMessage(""); setRenaming(true);
		try {
			await post(`/api/admin/dealer-groups/${group.id}/name`, { groupName: groupName.trim() });
			setMessage(`Renamed to ${groupName.trim()}.`);
			reload();
		} catch (caught) { setError(caught instanceof Error ? caught.message : "The group could not be renamed"); }
		finally { setRenaming(false); }
	}

	async function addDealer() {
		setError(""); setMessage(""); setAdding(true);
		try {
			await post(`/api/admin/dealer-groups/${group.id}/dealers`, { dealerCode: dealerCode.trim(), isMainDealer: asMainDealer });
			setMessage(`${dealerCode.trim()} added to ${group.groupCode}.`);
			setDealerCode(""); setAsMainDealer(false);
			reload();
		} catch (caught) { setError(caught instanceof Error ? caught.message : "That dealer could not be added"); }
		finally { setAdding(false); }
	}

	return <>
		<PageHead
			eyebrow="Dealer groups"
			title={group.groupName}
			lead={`Group code ${group.groupCode}. Membership lets these dealers name each other as Bill-To and Ship-To — it never exposes a sibling's orders, credit or logins.`}
			actions={<Button variant="secondary" onClick={onBack}>Back to groups</Button>}
		/>

		<section className="panel">
			<div className="panel-head"><h3>Group details</h3><StatusPill value={group.status} /></div>
			<div className="panel-body">
				<div className="grid-2">
					<FormField label="Group name" htmlFor="group-name">
						<Input id="group-name" value={groupName} onChange={(event) => setGroupName(event.target.value)} />
					</FormField>
					{/* Read-only on purpose: the code is what dealers quote on a membership
					    request and what the CSV import matches on, so changing it would
					    silently orphan both. */}
					<FormField label="Group code" htmlFor="group-code" hint="Set once when the group is created and never changed.">
						<Input id="group-code" value={group.groupCode} readOnly disabled />
					</FormField>
				</div>
				<Button disabled={!renamed} loading={renaming} onClick={() => void rename()}>{renaming ? "Saving…" : "Save name"}</Button>
			</div>
		</section>

		<section className="panel" style={{ marginTop: 18 }}>
			<div className="panel-head"><h3>Add a dealer to this group</h3></div>
			<div className="panel-body">
				<div className="grid-2">
					<FormField label="Dealer code" htmlFor="assign-dealer-code" hint="The dealer's own code, exactly as it appears in Dealers.">
						<Input id="assign-dealer-code" value={dealerCode} placeholder="BIHAR-0137" onChange={(event) => setDealerCode(event.target.value)} />
					</FormField>
				</div>
				<div style={{ margin: "4px 0 14px" }}>
					<Checkbox label="Make this the main dealer of the group" checked={asMainDealer} onChange={(event) => setAsMainDealer(event.target.checked)} />
				</div>
				<Button disabled={!dealerCode.trim()} loading={adding} onClick={() => void addDealer()}>{adding ? "Adding…" : "Add dealer"}</Button>
				{asMainDealer && <p className="notice" style={{ marginTop: 14 }}>A group has one main dealer. Whoever holds it now will lose it.</p>}
			</div>
		</section>

		{message && <p className="notice" style={{ marginTop: 18 }}>{message}</p>}
		{error && <p className="form-error" role="alert">{error}</p>}

		<section className="panel" style={{ marginTop: 18 }}>
			<div className="panel-head"><h3>{count(members.length)} {members.length === 1 ? "member" : "members"}</h3></div>
			{members.length === 0
				? <div className="empty"><h3>No dealers in this group yet</h3><p>Add one by dealer code above, or approve a pending request in Group Requests.</p></div>
				: <div className="table-wrap"><table className="data-table">
					<thead><tr><th>Dealer</th><th>Role</th><th>Location</th><th>GSTIN</th><th>Account state</th></tr></thead>
					<tbody>{members.map((dealer) => <tr key={dealer.id}>
						<td><b>{dealer.displayName}</b><div className="tiny">{dealer.dealerCode}</div></td>
						<td>{dealer.isMainDealer ? <b>Main dealer</b> : <span className="tiny">Member</span>}</td>
						<td>{[dealer.city, dealer.state].filter(Boolean).join(", ") || dash}</td>
						<td>{dealer.gstin ?? dash}</td>
						<td>{dealer.accountState ? <StatusPill value={dealer.accountState} /> : <span className="tiny">Not set</span>}</td>
					</tr>)}</tbody>
				</table></div>}
		</section>
	</>;
}

/* ----------------------------------------------------------------- Dealer groups */
export function DealerGroupsSection() {
	const groupsSection = useAdminSection<{ groups: AdminDealerGroupRow[] }>("/api/admin/dealer-groups");
	const dealersSection = useAdminSection<{ dealers: AdminDealerRow[] }>("/api/admin/dealers");
	const [openId, setOpenId] = useState<string | null>(null);
	const [groupCode, setGroupCode] = useState("");
	const [groupName, setGroupName] = useState("");
	const [creating, setCreating] = useState(false);
	const [created, setCreated] = useState<string | null>(null);
	const [error, setError] = useState("");
	const [query, setQuery] = useState("");

	const groups = groupsSection.data?.groups ?? [];
	const dealers = dealersSection.data?.dealers ?? [];
	const open = groups.find((group) => group.id === openId);
	const reload = () => { groupsSection.reload(); dealersSection.reload(); };
	const needle = query.trim().toLowerCase();
	// Client-side only: the list is a few hundred rows at most, never paginated.
	const visibleGroups = needle
		? groups.filter((group) => `${group.groupName} ${group.groupCode}`.toLowerCase().includes(needle))
		: groups;

	async function create() {
		setError(""); setCreated(null); setCreating(true);
		try {
			await post("/api/admin/dealer-groups", { groupCode: groupCode.trim(), groupName: groupName.trim() });
			setCreated(groupCode.trim().toUpperCase());
			setGroupCode(""); setGroupName("");
			groupsSection.reload();
		} catch (caught) { setError(caught instanceof Error ? caught.message : "The group could not be created"); }
		finally { setCreating(false); }
	}

	if (open) return <GroupDetail group={open} dealers={dealers} onBack={() => setOpenId(null)} reload={reload} />;

	return <>
		<PageHead
			eyebrow="Dealer groups"
			title="Dealer Groups"
			lead="A group lets several dealer accounts under one owner name each other as Bill-To and Ship-To. Nothing else is shared."
		/>
		<section className="panel">
			<div className="panel-head"><h3>Create a group</h3></div>
			<div className="panel-body">
				<div className="grid-2">
					<FormField label="Group code *" htmlFor="new-group-code" hint="Letters, numbers and underscores. Dealers quote this to ask to join, and Dealer Import matches on it.">
						<Input id="new-group-code" value={groupCode} placeholder="GANESH" onChange={(event) => setGroupCode(event.target.value)} />
					</FormField>
					<FormField label="Group name *" htmlFor="new-group-name">
						<Input id="new-group-name" value={groupName} placeholder="Shree Ganesh Retail" onChange={(event) => setGroupName(event.target.value)} />
					</FormField>
				</div>
				<Button disabled={!groupCode.trim() || groupName.trim().length < 2} loading={creating} onClick={() => void create()}>
					{creating ? "Creating…" : "Create group"}
				</Button>
				{created && <p className="notice">Group {created} created. Add dealers to it below, or let them request to join and approve it in Group Requests.</p>}
				{error && <p className="form-error" role="alert">{error}</p>}
			</div>
		</section>

		{groupsSection.status !== "ready" ? <SectionState status={groupsSection.status} retry={reload} /> : groups.length === 0
			? <div className="empty"><h3>No dealer groups yet</h3><p>Until a group exists, a group code in Add Dealer or a CSV import has nothing to point at and the row will be refused.</p></div>
			: <section className="panel" style={{ marginTop: 18 }}>
				<div className="panel-head">
					<h3>{count(visibleGroups.length)}{visibleGroups.length !== groups.length ? ` of ${count(groups.length)}` : ""} {visibleGroups.length === 1 ? "group" : "groups"}</h3>
					<SearchField label="Search dealer groups" style={{ minWidth: 220 }} placeholder="Search group name or code" value={query} onChange={(event) => setQuery(event.target.value)} />
				</div>
				{visibleGroups.length === 0 ? <div className="empty"><h3>No matching groups</h3><p>Try a different search.</p></div> : <div className="table-wrap"><table className="data-table">
					<thead><tr><th>Group</th><th>Code</th><th>Main dealer</th><th>Dealers</th><th>Status</th><th /></tr></thead>
					<tbody>{visibleGroups.map((group) => {
						// Derived from the dealer rows, which is the same fact the member
						// table renders -- so the two screens can never disagree.
						const main = dealers.find((dealer) => dealer.groupCode === group.groupCode && dealer.isMainDealer);
						return <tr key={group.id}>
							<td><b>{group.groupName}</b></td>
							<td>{group.groupCode}</td>
							<td>{main ? main.displayName : <span className="tiny">{dealersSection.status === "ready" ? "None set" : "Loading…"}</span>}</td>
							<td>{count(group.dealerCount)}</td>
							<td><StatusPill value={group.status} /></td>
							<td className="right"><Button variant="secondary" size="sm" onClick={() => setOpenId(group.id)}>View</Button></td>
						</tr>;
					})}</tbody>
				</table></div>}
			</section>}
	</>;
}

/* --------------------------------------------------------------- Group requests */
export function GroupRequestsSection() {
	const { data, status, reload } = useAdminSection<{ requests: MembershipRequestRow[] }>("/api/admin/dealer-groups/requests");
	const [openId, setOpenId] = useState<string | null>(null);
	const [notes, setNotes] = useState("");
	const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
	const [error, setError] = useState("");
	const [query, setQuery] = useState("");
	const allRequests = data?.requests ?? [];
	const needle = query.trim().toLowerCase();
	// Client-side only: the list is a few hundred rows at most, never paginated.
	const requests = needle
		? allRequests.filter((request) => `${request.dealerName} ${request.dealerCode} ${request.requestedGroupCode}`.toLowerCase().includes(needle))
		: allRequests;
	const open = allRequests.find((request) => request.id === openId);

	async function decide(action: "approve" | "reject") {
		if (!open) return;
		setError(""); setBusy(action);
		try {
			await post(`/api/admin/dealer-groups/requests/${open.id}/${action}`, action === "reject" ? { notes: notes.trim() } : {});
			setOpenId(null); setNotes(""); reload();
		} catch (caught) { setError(caught instanceof Error ? caught.message : "The request could not be decided"); }
		finally { setBusy(null); }
	}

	if (open) return <>
		<PageHead
			eyebrow="Dealer groups"
			title={`${open.dealerName || open.dealerCode} wants to join ${open.requestedGroupCode}`}
			actions={<Button variant="secondary" onClick={() => { setOpenId(null); setNotes(""); setError(""); }}>Back to requests</Button>}
		/>
		<section className="panel"><div className="panel-body">
			<dl className="control-detail-grid">
				<div><dt>Dealer</dt><dd>{open.dealerName || dash}</dd></div>
				<div><dt>Dealer code</dt><dd>{open.dealerCode || dash}</dd></div>
				<div><dt>Group code they quoted</dt><dd>{open.requestedGroupCode}</dd></div>
				<div><dt>Requested</dt><dd>{shortDate(open.requestedAt)}</dd></div>
			</dl>
			<p className="notice">
				Approving moves this dealer into the group with that code. Check with the group's owner first — a dealer
				can quote any code, and joining lets them name every other dealer in the group as Bill-To and Ship-To.
			</p>
			<FormField label="Reason (required to decline, and shown to the dealer)" htmlFor="request-notes">
				<Input id="request-notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
			</FormField>
			<div className="control-actions-row">
				<Button loading={busy === "approve"} disabled={busy !== null} onClick={() => void decide("approve")}>
					{busy === "approve" ? "Approving…" : "Approve and add to group"}
				</Button>
				<Button variant="secondary" loading={busy === "reject"} disabled={busy !== null || notes.trim().length < 3} onClick={() => void decide("reject")}>
					{busy === "reject" ? "Declining…" : "Decline"}
				</Button>
			</div>
			{error && <p className="form-error" role="alert">{error}</p>}
		</div></section>
	</>;

	return <>
		<PageHead
			eyebrow="Dealer groups"
			title="Group Requests"
			lead="Dealers ask to join a group by quoting its code. Nobody joins automatically — a KITCO admin decides every one."
		/>
		{status !== "ready" ? <SectionState status={status} retry={reload} /> : allRequests.length === 0
			? <SectionState status="ready" retry={reload} empty="No dealer is waiting to join a group." />
			: <section className="panel">
				<div className="panel-head">
					<h3>{count(requests.length)}{requests.length !== allRequests.length ? ` of ${count(allRequests.length)}` : ""} awaiting a decision</h3>
					<SearchField label="Search group requests" style={{ minWidth: 220 }} placeholder="Search dealer or group code" value={query} onChange={(event) => setQuery(event.target.value)} />
				</div>
				{requests.length === 0 ? <div className="empty"><h3>No matching requests</h3><p>Try a different search.</p></div> : <div className="table-wrap"><table className="data-table">
					<thead><tr><th>Dealer</th><th>Group code quoted</th><th>Requested</th><th>Status</th><th /></tr></thead>
					<tbody>{requests.map((request) => <tr key={request.id}>
						<td><b>{request.dealerName || dash}</b><div className="tiny">{request.dealerCode}</div></td>
						<td>{request.requestedGroupCode}</td>
						<td>{shortDate(request.requestedAt)}</td>
						<td><StatusPill value={request.status} /></td>
						<td className="right"><Button variant="secondary" size="sm" onClick={() => setOpenId(request.id)}>Review</Button></td>
					</tr>)}</tbody>
				</table></div>}
			</section>}
	</>;
}

/* ------------------------------------------------------------ GST registrations */
export function GstRegistrationsSection() {
	const { data, status, reload } = useAdminSection<{ registrations: GstRegistrationRow[] }>("/api/admin/gst-registrations");
	const [query, setQuery] = useState("");
	const registrations = data?.registrations ?? [];
	const rows = registrations.filter((registration) => !query || [
		registration.gstin, registration.legalName ?? "", registration.tradeName ?? "", registration.state ?? "",
		...registration.dealers.map((dealer) => `${dealer.dealerCode} ${dealer.displayName}`),
	].join(" ").toLowerCase().includes(query.toLowerCase()));
	const shared = registrations.filter((registration) => registration.dealers.length > 1).length;
	const outlets = registrations.reduce((total, registration) => total + registration.dealers.length, 0);
	const verified = registrations.filter((registration) => registration.verificationStatus === "VERIFIED").length;

	return <>
		<PageHead
			eyebrow="Dealer master"
			title="GST Registrations"
			lead="One row per real registration. Several dealers sharing a GSTIN is normal — GST issues one GSTIN per PAN per state, covering every additional place of business under it."
		/>
		{status !== "ready" ? <SectionState status={status} retry={reload} /> : registrations.length === 0
			? <SectionState status="ready" retry={reload} empty="No GSTIN has been recorded against a dealer yet." />
			: <>
				<div className="stat-grid">
					<div className="stat"><div className="k">Registrations</div><div className="v">{count(registrations.length)}</div></div>
					<div className="stat"><div className="k">Dealer outlets</div><div className="v">{count(outlets)}</div><div className="d">trading under them</div></div>
					<div className="stat"><div className="k">Shared</div><div className="v">{count(shared)}</div><div className="d">used by more than one dealer</div></div>
					<div className="stat"><div className="k">Verified</div><div className="v">{count(verified)}</div><div className="d">by a live GST provider</div></div>
				</div>
				{verified === 0 && <p className="notice" style={{ marginBottom: 18 }}>
					No GST provider is connected, so nothing here has been checked against the GST registry. Every number below is
					as it was typed or imported.
				</p>}
				<section className="panel">
					<div className="panel-head">
						<h3>{count(rows.length)} {rows.length === 1 ? "registration" : "registrations"}</h3>
						<SearchField label="Search GST registrations" style={{ minWidth: 220 }} placeholder="Search GSTIN, name or dealer" value={query} onChange={(event) => setQuery(event.target.value)} />
					</div>
					{rows.length === 0
						? <div className="empty"><h3>No matching registrations</h3><p>Try a different search.</p></div>
						: <div className="table-wrap"><table className="data-table">
							<thead><tr><th>GSTIN</th><th>Name on record</th><th>State</th><th>Verification</th><th>Dealers</th></tr></thead>
							<tbody>{rows.map((registration) => <tr key={registration.id}>
								<td><b>{registration.gstin}</b>{registration.gstStatus && <div className="tiny">GST status {registration.gstStatus}</div>}</td>
								{/* Blank until a provider fills it in. A dealer's display name would
								    look like the registry's answer and it is not. */}
								<td>{registration.legalName ?? <span className="tiny">Not on record</span>}{registration.tradeName && <div className="tiny">{registration.tradeName}</div>}</td>
								<td>{registration.state ?? dash}</td>
								<td><VerificationBadge status={registration.verificationStatus} verifiedAt={registration.verifiedAt} provider={registration.provider} /></td>
								<td>
									{registration.dealers.length === 0
										? <span className="tiny">No dealer uses this yet</span>
										: <ul className="plain-list">{registration.dealers.map((dealer) => <li key={dealer.dealerId}>
											{dealer.displayName}
											<span className="tiny"> {dealer.dealerCode}{dealer.isMainDealer && " · main dealer"}{dealer.city ? ` · ${dealer.city}` : ""}</span>
										</li>)}</ul>}
								</td>
							</tr>)}</tbody>
						</table></div>}
				</section>
			</>}
	</>;
}
