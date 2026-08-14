import { forwardRef, type ButtonHTMLAttributes } from "react";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	/** Required — this control has no visible text, so its accessible name comes from here. */
	label: string;
	size?: "sm" | "md";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
	{ label, size = "md", className, type = "button", ...rest },
	ref,
) {
	return <button ref={ref} type={type} aria-label={label} className={["ui-icon-btn", `ui-icon-btn-${size}`, className ?? ""].filter(Boolean).join(" ")} {...rest} />;
});
