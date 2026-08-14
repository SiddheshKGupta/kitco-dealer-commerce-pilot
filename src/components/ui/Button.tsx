import { forwardRef, type ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: ButtonVariant;
	size?: ButtonSize;
	full?: boolean;
	loading?: boolean;
}

/** The one button visual system. Every CTA in the app renders through this —
 *  no feature owns its own button styling. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
	{ variant = "primary", size = "md", full = false, loading = false, disabled, className, children, type = "button", ...rest },
	ref,
) {
	const classes = ["ui-btn", `ui-btn-${variant}`, `ui-btn-${size}`, full ? "ui-btn-full" : "", className ?? ""].filter(Boolean).join(" ");
	return <button ref={ref} type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
		{loading && <span className="ui-btn-spinner" aria-hidden="true" />}
		<span className={loading ? "ui-btn-label-loading" : undefined}>{children}</span>
	</button>;
});
