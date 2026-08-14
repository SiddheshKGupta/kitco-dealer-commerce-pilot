import { useRef, type KeyboardEvent } from "react";

export interface TabItem { id: string; label: string }

interface TabsProps {
	items: TabItem[];
	activeId: string;
	onChange: (id: string) => void;
	label: string;
}

export function Tabs({ items, activeId, onChange, label }: TabsProps) {
	const refs = useRef<Array<HTMLButtonElement | null>>([]);
	function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
		const target = event.key === "Home" ? 0
			: event.key === "End" ? items.length - 1
			: event.key === "ArrowRight" ? (index + 1) % items.length
			: event.key === "ArrowLeft" ? (index - 1 + items.length) % items.length
			: -1;
		if (target < 0) return;
		event.preventDefault();
		onChange(items[target].id);
		refs.current[target]?.focus();
	}
	return <div className="ui-tabs" role="tablist" aria-label={label}>
		{items.map((item, index) => <button
			key={item.id}
			ref={(node) => { refs.current[index] = node; }}
			role="tab"
			type="button"
			aria-selected={item.id === activeId}
			tabIndex={item.id === activeId ? 0 : -1}
			className="ui-tab"
			onKeyDown={(event) => onKeyDown(event, index)}
			onClick={() => onChange(item.id)}
		>{item.label}</button>)}
	</div>;
}
