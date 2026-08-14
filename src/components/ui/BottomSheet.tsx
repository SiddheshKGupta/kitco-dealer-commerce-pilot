import { useRef, type ReactNode } from "react";
import { IconButton } from "./IconButton";
import { useFocusTrap } from "./useFocusTrap";

interface BottomSheetProps {
	open: boolean;
	onClose: () => void;
	title: string;
	children: ReactNode;
	footer?: ReactNode;
}

export function BottomSheet({ open, onClose, title, children, footer }: BottomSheetProps) {
	const closeRef = useRef<HTMLButtonElement>(null);
	const dialogRef = useRef<HTMLElement>(null);
	useFocusTrap(open, onClose, dialogRef, closeRef);
	if (!open) return null;
	return <div className="ui-sheet-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
		<section ref={dialogRef as React.RefObject<HTMLElement>} className="ui-sheet" role="dialog" aria-modal="true" aria-label={title}>
			<header className="ui-sheet-head">
				<p>{title}</p>
				<IconButton ref={closeRef} label="Close" onClick={onClose}>✕</IconButton>
			</header>
			<div className="ui-sheet-body">{children}</div>
			{footer && <div className="ui-sheet-footer">{footer}</div>}
		</section>
	</div>;
}
