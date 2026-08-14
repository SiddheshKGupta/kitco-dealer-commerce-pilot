import { forwardRef, useState, type InputHTMLAttributes } from "react";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
	{ className, ...rest },
	ref,
) {
	return <input ref={ref} className={["ui-input", className ?? ""].filter(Boolean).join(" ")} {...rest} />;
});

export function PasswordInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
	const [visible, setVisible] = useState(false);
	return <div className="ui-password">
		<input type={visible ? "text" : "password"} className={["ui-input", "ui-password-input", className ?? ""].filter(Boolean).join(" ")} {...rest} />
		<button type="button" className="ui-password-toggle" onClick={() => setVisible((current) => !current)} aria-label={visible ? "Hide password" : "Show password"}>
			{visible ? "Hide" : "Show"}
		</button>
	</div>;
}
