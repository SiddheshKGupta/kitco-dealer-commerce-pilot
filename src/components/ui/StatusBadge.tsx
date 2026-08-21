import type { ReactNode } from "react";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

interface StatusBadgeProps {
	tone: StatusTone;
	children: ReactNode;
}

/** Status is never colour alone — the word is always present too. */
export function StatusBadge({ tone, children }: StatusBadgeProps) {
	return <span className={`ui-status ui-status-${tone}`}>{children}</span>;
}
