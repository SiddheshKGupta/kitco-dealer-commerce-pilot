export type ToastTone = "default" | "success" | "danger";

interface ToastProps {
	message: string;
	tone?: ToastTone;
}

/** Floating, bottom-right, self-contained — parent owns the message state and
 *  clears it (typically on a timeout) to dismiss. */
export function Toast({ message, tone = "default" }: ToastProps) {
	if (!message) return null;
	return <div className={`ui-toast ui-toast-${tone}`} role="status">{message}</div>;
}
