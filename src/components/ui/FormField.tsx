import type { ReactNode } from "react";

interface FormFieldProps {
	label: string;
	htmlFor: string;
	error?: string;
	hint?: string;
	children: ReactNode;
}

export function FormField({ label, htmlFor, error, hint, children }: FormFieldProps) {
	return <div className="ui-field">
		<label htmlFor={htmlFor}>{label}</label>
		{children}
		{error ? <p className="ui-field-error" role="alert">{error}</p> : hint ? <p className="ui-field-hint">{hint}</p> : null}
	</div>;
}
