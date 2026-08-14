import { useRef, type ReactNode } from "react";
import { IconButton } from "./IconButton";
import { useFocusTrap } from "./useFocusTrap";

interface ModalProps {
	open: boolean;
	onClose: () => void;
	title: string;
	children: ReactNode;
	footer?: ReactNode;
}

/** Centred desktop/tablet dialog. Use BottomSheet for mobile-primary flows
 *  (filters, quick actions) — Modal is for confirmations and detail review. */
export function Modal({ open, onClose, title, children, footer }: ModalProps) {
	const closeRef = useRef<HTMLButtonElement>(null);
	const dialogRef = useRef<HTMLElement>(null);
	useFocusTrap(open, onClose, dialogRef, closeRef);
	if (!open) return null;
	return <div className="ui-modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
		<section ref={dialogRef as React.RefObject<HTMLElement>} className="ui-modal" role="dialog" aria-modal="true" aria-label={title}>
			<header className="ui-modal-head">
				<p>{title}</p>
				<IconButton ref={closeRef} label="Close" onClick={onClose}>✕</IconButton>
			</header>
			<div className="ui-modal-body">{children}</div>
			{footer && <div className="ui-modal-footer">{footer}</div>}
		</section>
	</div>;
}
