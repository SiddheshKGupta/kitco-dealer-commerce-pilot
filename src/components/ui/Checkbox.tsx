import type { InputHTMLAttributes, ReactNode } from "react";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
	label: ReactNode;
}

export function Checkbox({ label, className, ...rest }: CheckboxProps) {
	return <label className="ui-checkbox">
		<input type="checkbox" className={["ui-checkbox-input", className ?? ""].filter(Boolean).join(" ")} {...rest} />
		<span>{label}</span>
	</label>;
}
