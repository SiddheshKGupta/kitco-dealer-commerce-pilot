import type { InputHTMLAttributes } from "react";

interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
	label: string;
}

export function SearchField({ label, className, ...rest }: SearchFieldProps) {
	return <label className="ui-search">
		<svg className="ui-search-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" /><path d="M14 14L18 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
		<span className="sr-only">{label}</span>
		<input type="search" aria-label={label} className={["ui-search-input", className ?? ""].filter(Boolean).join(" ")} {...rest} />
	</label>;
}
