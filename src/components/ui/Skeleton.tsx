import type { CSSProperties } from "react";

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
	return <span className={["ui-skeleton", className ?? ""].filter(Boolean).join(" ")} style={style} aria-hidden="true" />;
}
