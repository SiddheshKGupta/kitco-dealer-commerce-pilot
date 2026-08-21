import { useEffect, useRef, type ReactNode } from "react";
import { IconButton } from "./IconButton";

interface BottomSheetProps {
	open: boolean;
	onClose: () => void;
	title: string;
	children: ReactNode;
	footer?: ReactNode;
}

// jsdom (used by the test suite) doesn't implement showModal/close/native Escape,
// so environments without it get a minimal manual shim; real browsers never take this path.
const supportsNativeDialog = typeof HTMLDialogElement !== "undefined" && typeof HTMLDialogElement.prototype.showModal === "function";

/** Uses the browser's native <dialog> element instead of a custom fixed-position
 *  overlay + CSS animation. The browser owns showing/centering/focus-trapping/
 *  Escape-to-close, the same way it owns a native <select> dropdown -- removing
 *  the whole class of "stuck invisible" bugs a hand-rolled scrim+animation can hit. */
export function BottomSheet({ open, onClose, title, children, footer }: BottomSheetProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const restoreFocusRef = useRef<HTMLElement | null>(null);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		if (open && !dialog.open) {
			if (supportsNativeDialog) dialog.showModal();
			else { restoreFocusRef.current = document.activeElement as HTMLElement | null; dialog.open = true; }
		} else if (!open && dialog.open) {
			if (supportsNativeDialog) dialog.close();
			else { dialog.open = false; restoreFocusRef.current?.focus(); }
		}
	}, [open]);

	useEffect(() => {
		if (supportsNativeDialog || !open) return;
		const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open, onClose]);

	return <dialog
		ref={dialogRef}
		className="ui-native-sheet"
		aria-label={title}
		onClose={onClose}
		onCancel={onClose}
		onClick={(event) => { if (event.target === dialogRef.current) onClose(); }}
	>
		<header className="ui-sheet-head">
			<p>{title}</p>
			<IconButton label="Close" onClick={onClose}>✕</IconButton>
		</header>
		<div className="ui-sheet-body">{children}</div>
		{footer && <div className="ui-sheet-footer">{footer}</div>}
	</dialog>;
}
