import { useRef, useState } from "react";
import { Button, Checkbox, FormField, Input } from "../../components/ui";
import { PageHead, SectionState, StatusPill } from "./ControlSections";
import { useAdminSection } from "./useAdminSection";

export interface AdminDealerRow {
	id: string;
	dealerCode: string;
	legalName: string | null;
	displayName: string;
	groupCode: string | null;
	gstin: string | null;
	city: string | null;
	state: string | null;
	isMainDealer: boolean;
	accountState: string | null;
	credentialsIssuedAt: string | null;
	firstLoginAt: string | null;
	lastLoginAt: string | null;
	loginEmail: string | null;
}

interface IssuedCredentials {
	dealerId: string;
	dealerCode: string;
	loginEmail: string;
	password: string;
	accountState: string;
	credentialsIssuedAt: string;
	reissued: boolean;
}

interface ImportRowPlan { line: number; dealerCode: string; action: string; changes: string[]; errors: string[] }
interface ImportPlan { rows: ImportRowPlan[]; totals: { create: number; update: number; skip: number; error: number }; committed: boolean }

const dash = "—";
const shortDate = (value: string | null) => value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : dash;

export async function post<T>(path: string, body?: unknown): Promise<T> {
	const response = await fetch(path, {
		method: "POST", credentials: "include", headers: { "content-type": "application/json" },
		body: JSON.stringify(body ?? {}),
	});
	const payload = await response.json() as T & { error?: { message?: string } };
	if (!response.ok) throw new Error(payload.error?.message ?? "That did not work. Try again.");
	return payload;
}

/* ----------------------------------------------------------- Add dealer form */
/** Driven off a list rather than fifteen near-identical JSX blocks. `required` matches
 *  the server's schema exactly -- dealer code and legal name are the only two the
 *  create route insists on. */
const FIELDS: { key: string; label: string; required?: boolean; placeholder?: string }[] = [
	{ key: "dealerCode", label: "Dealer code", required: true, placeholder: "BIHAR-0137" },
	{ key: "legalName", label: "Legal name (as on GST)", required: true, placeholder: "SHREE GANESH FOOTWEAR PRIVATE LIMITED" },
	{ key: "displayName", label: "Display name", placeholder: "Shree Ganesh Footwear" },
	{ key: "groupCode", label: "Dealer group code", placeholder: "GANESH" },
	{ key: "gstin", label: "GSTIN", placeholder: "10AXYPJ2171Q1ZX" },
	{ key: "addressLine1", label: "Address line 1" },
	{ key: "addressLine2", label: "Address line 2" },
	{ key: "city", label: "City" },
	{ key: "state", label: "State" },
	{ key: "pinCode", label: "PIN code", placeholder: "842001" },
	{ key: "contactPerson", label: "Contact person" },
	{ key: "mobile", label: "Mobile", placeholder: "9006875566" },
	{ key: "primaryEmail", label: "Primary email", placeholder: "orders@dealer.example" },
	{ key: "secondaryEmail", label: "Secondary email" },
];

function AddDealerPanel({ onCreated }: { onCreated: () => void }) {
	const [values, setValues] = useState<Record<string, string>>({});
	const [isMainDealer, setIsMainDealer] = useState(false);
	const [saving, setSaving] = useState(false);
	const [created, setCreated] = useState<string | null>(null);
	const [error, setError] = useState("");
	const ready = Boolean(values.dealerCode?.trim() && values.legalName?.trim());

	async function submit() {
		setError(""); setCreated(null); setSaving(true);
		try {
			// Blank optional fields are dropped, not sent as "": the server's schema
			// rejects an empty string, and an untouched field means "no value", not "clear".
			const body: Record<string, unknown> = { isMainDealer };
			for (const field of FIELDS) {
				const value = values[field.key]?.trim();
				if (value) body[field.key] = value;
			}
			const dealer = await post<AdminDealerRow>("/api/admin/dealers", body);
			setCreated(dealer.dealerCode);
			setValues({}); setIsMainDealer(false);
			onCreated();
		} catch (caught) { setError(caught instanceof Error ? caught.message : "Dealer could not be created"); }
		finally { setSaving(false); }
	}

	return <section className="panel">
		<div className="panel-head"><h3>Add dealer</h3></div>
		<div className="panel-body">
			<div className="grid-2">
				{FIELDS.map((field) => <FormField key={field.key} label={field.required ? `${field.label} *` : field.label} htmlFor={`add-dealer-${field.key}`}>
					<Input
						id={`add-dealer-${field.key}`}
						value={values[field.key] ?? ""}
						placeholder={field.placeholder}
						onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
					/>
				</FormField>)}
			</div>
			<div style={{ margin: "14px 0" }}>
				<Checkbox label="Main dealer of its group" checked={isMainDealer} onChange={(event) => setIsMainDealer(event.target.checked)} />
			</div>
			<Button disabled={!ready} loading={saving} onClick={() => void submit()}>{saving ? "Creating…" : "Create dealer"}</Button>
			{created && <p className="notice">Dealer {created} created. They start at IMPORTED — issue credentials below when you're ready to hand them over.</p>}
			{error && <p className="form-error" role="alert">{error}</p>}
		</div>
	</section>;
}

/* --------------------------------------------------- Dealer onboarding section */
export function DealerOnboardingSection() {
	const { data, status, reload } = useAdminSection<{ dealers: AdminDealerRow[] }>("/api/admin/dealers");
	const [busyId, setBusyId] = useState<string | null>(null);
	const [issued, setIssued] = useState<IssuedCredentials | null>(null);
	const [error, setError] = useState("");
	const dealers = data?.dealers ?? [];

	async function act(dealerId: string, run: () => Promise<void>) {
		setError(""); setBusyId(dealerId);
		try { await run(); reload(); }
		catch (caught) { setError(caught instanceof Error ? caught.message : "That did not work. Try again."); }
		finally { setBusyId(null); }
	}

	const issue = (dealerId: string) => act(dealerId, async () => {
		setIssued(await post<IssuedCredentials>(`/api/admin/dealers/${dealerId}/credentials`));
	});
	const changeState = (dealerId: string, action: "SUSPEND" | "RESTORE") => act(dealerId, async () => {
		await post(`/api/admin/dealers/${dealerId}/account-state`, { action });
	});

	return <>
		<PageHead
			eyebrow="Dealer onboarding"
			title="Dealer Onboarding"
			lead="Create a dealer, then issue their sign-in credentials. KITCO passes the password on itself — nothing is emailed from here."
		/>
		<AddDealerPanel onCreated={reload} />

		{issued && <section className="panel" style={{ marginTop: 18 }}>
			<div className="panel-head"><h3>Credentials for {issued.dealerCode}</h3></div>
			<div className="panel-body">
				<p className="notice">
					Emailed to the dealer just now. Shown here too, once, in case you need it -- it isn't
					stored anywhere. They'll be made to choose their own password the first time they sign in.
					{issued.reissued && " This replaced their previous password, which no longer works."}
				</p>
				<dl className="control-detail-grid" style={{ marginTop: 16 }}>
					<div><dt>Dealer code</dt><dd>{issued.dealerCode}</dd></div>
					<div><dt>One-time code goes to</dt><dd>{issued.loginEmail}</dd></div>
					<div><dt>Initial password</dt><dd style={{ fontFamily: "monospace", letterSpacing: ".08em" }}>{issued.password}</dd></div>
					<div><dt>Account state</dt><dd><StatusPill value={issued.accountState} /></dd></div>
				</dl>
				<Button variant="secondary" onClick={() => setIssued(null)}>I've saved these</Button>
			</div>
		</section>}

		{error && <p className="form-error" role="alert">{error}</p>}

		{status !== "ready" ? <SectionState status={status} retry={reload} /> : dealers.length === 0
			? <SectionState status="ready" retry={reload} empty="No dealers yet." />
			: <section className="panel" style={{ marginTop: 18 }}>
				<div className="panel-head"><h3>{dealers.length.toLocaleString("en-IN")} dealers</h3></div>
				<div className="table-wrap"><table className="data-table">
					<thead><tr><th>Dealer</th><th>Group</th><th>GSTIN</th><th>Sign-in email</th><th>Account state</th><th>Credentials issued</th><th /></tr></thead>
					<tbody>{dealers.map((dealer) => {
						const busy = busyId === dealer.id;
						const suspended = dealer.accountState === "SUSPENDED" || dealer.accountState === "DISABLED";
						return <tr key={dealer.id}>
							<td><b>{dealer.displayName}</b><div className="tiny">{dealer.dealerCode}{dealer.isMainDealer && " · main dealer"}</div></td>
							<td>{dealer.groupCode ?? dash}</td>
							<td>{dealer.gstin ?? dash}</td>
							{/* Honest about the gap rather than showing a plausible blank: with no
							    address on file an OTP has nowhere to go, and issuance will say so. */}
							<td>{dealer.loginEmail ?? <span className="tiny">No email on file</span>}</td>
							<td>{dealer.accountState ? <StatusPill value={dealer.accountState} /> : <span className="tiny">Not set</span>}</td>
							<td>{shortDate(dealer.credentialsIssuedAt)}</td>
							<td className="right" style={{ whiteSpace: "nowrap" }}>
								<Button variant="secondary" size="sm" loading={busy} disabled={busy} onClick={() => void issue(dealer.id)}>
									{dealer.credentialsIssuedAt ? "Re-issue" : "Issue credentials"}
								</Button>
								{" "}
								{suspended
									? <Button variant="secondary" size="sm" loading={busy} disabled={busy} onClick={() => void changeState(dealer.id, "RESTORE")}>Restore</Button>
									: <Button variant="secondary" size="sm" loading={busy} disabled={busy} onClick={() => void changeState(dealer.id, "SUSPEND")}>Suspend</Button>}
							</td>
						</tr>;
					})}</tbody>
				</table></div>
			</section>}
	</>;
}

/* ------------------------------------------------------------- Dealer import */
export function DealerImportSection() {
	const fileInput = useRef<HTMLInputElement>(null);
	const [csv, setCsv] = useState("");
	const [fileName, setFileName] = useState("");
	const [plan, setPlan] = useState<ImportPlan | null>(null);
	const [checking, setChecking] = useState(false);
	const [committing, setCommitting] = useState(false);
	const [error, setError] = useState("");

	async function choose(file: File) {
		setError(""); setPlan(null); setChecking(true);
		try {
			const text = await file.text();
			setCsv(text); setFileName(file.name);
			// Preview only. This call writes nothing at all -- the commit below is a
			// separate, deliberate action.
			setPlan(await post<ImportPlan>("/api/admin/dealers/import/preview", { csv: text, fileName: file.name }));
		} catch (caught) {
			setCsv(""); setFileName("");
			setError(caught instanceof Error ? caught.message : "That file could not be read.");
		} finally { setChecking(false); }
	}

	async function commit() {
		setError(""); setCommitting(true);
		try { setPlan(await post<ImportPlan>("/api/admin/dealers/import/commit", { csv, fileName })); }
		catch (caught) { setError(caught instanceof Error ? caught.message : "The import could not be completed."); }
		finally { setCommitting(false); }
	}

	const totals = plan?.totals;
	const done = plan?.committed === true;
	const applicable = (totals?.create ?? 0) + (totals?.update ?? 0);

	return <>
		<PageHead
			eyebrow="Dealer onboarding"
			title="Dealer Import"
			lead="Upload a dealer list, see exactly what it would change, then import it. Checking a file never writes anything."
			actions={<a className="ui-btn ui-btn-secondary ui-btn-md" href="/api/admin/dealers/import/template.csv">Download template</a>}
		/>
		<section className="panel">
			<div className="panel-head"><h3>1 · Choose a file</h3></div>
			<div className="panel-body">
				<input
					ref={fileInput}
					type="file"
					accept=".csv,text/csv"
					className="sr-only"
					onChange={(event) => { const file = event.target.files?.[0]; if (file) void choose(file); event.target.value = ""; }}
				/>
				<Button variant="secondary" loading={checking} disabled={checking} onClick={() => fileInput.current?.click()}>
					{checking ? "Checking…" : fileName ? "Choose a different file" : "Choose CSV file"}
				</Button>
				{fileName && <p className="tiny" style={{ marginTop: 10 }}>{fileName}</p>}
				<p className="notice" style={{ marginTop: 14 }}>
					Dealers are matched on <b>dealer_code</b>. A code that already exists is updated; a new one is created.
					A blank cell leaves that field as it is — it never clears it.
				</p>
				{error && <p className="form-error" role="alert">{error}</p>}
			</div>
		</section>

		{plan && <section className="panel" style={{ marginTop: 18 }}>
			<div className="panel-head">
				<h3>{done ? "3 · Imported" : "2 · What this file would do"}</h3>
				{!done && <Button
					loading={committing}
					disabled={committing || applicable === 0 || (totals?.error ?? 0) > 0}
					onClick={() => void commit()}
				>{committing ? "Importing…" : `Import ${applicable} ${applicable === 1 ? "dealer" : "dealers"}`}</Button>}
			</div>
			<div className="panel-body">
				<div className="stat-grid">
					<div className="stat"><div className="k">{done ? "Created" : "To create"}</div><div className="v">{totals?.create ?? 0}</div></div>
					<div className="stat"><div className="k">{done ? "Updated" : "To update"}</div><div className="v">{totals?.update ?? 0}</div></div>
					<div className="stat"><div className="k">Unchanged</div><div className="v">{totals?.skip ?? 0}</div></div>
					<div className="stat"><div className="k">{done ? "Failed" : "With errors"}</div><div className="v">{totals?.error ?? 0}</div></div>
				</div>
				{!done && (totals?.error ?? 0) > 0 && <p className="notice">
					Nothing will be imported while any row has an error. Fix the rows below in your spreadsheet and choose the file again.
				</p>}
				{done && <p className="notice">Import finished. Re-uploading the same file is safe — every row that landed now reads as no change.</p>}
			</div>
			<div className="table-wrap"><table className="data-table">
				<thead><tr><th>Line</th><th>Dealer code</th><th>Outcome</th><th>Details</th></tr></thead>
				<tbody>{plan.rows.map((row) => <tr key={row.line}>
					<td>{row.line}</td>
					<td><b>{row.dealerCode || dash}</b></td>
					<td><StatusPill value={row.action} /></td>
					<td>
						{row.errors.length > 0
							? <span>{row.errors.join(" ")}</span>
							: row.changes.length > 0 ? <span className="tiny">{row.changes.join(", ")}</span> : dash}
					</td>
				</tr>)}</tbody>
			</table></div>
		</section>}
	</>;
}
