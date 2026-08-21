import type { ReactNode } from "react";

interface EmptyStateProps {
	title: string;
	description?: string;
	action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
	return <div className="ui-empty">
		<h3>{title}</h3>
		{description && <p>{description}</p>}
		{action}
	</div>;
}
