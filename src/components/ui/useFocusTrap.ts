import { useEffect, useRef } from "react";

/** Shared focus-trap behaviour for BottomSheet and Modal: focus the close control on
 *  open, cycle Tab within the dialog, close on Escape, restore focus on close. */
export function useFocusTrap(open: boolean, onClose: () => void, dialogRef: React.RefObject<HTMLElement | null>, closeRef: React.RefObject<HTMLButtonElement | null>) {
	const closeHandler = useRef(onClose);
	closeHandler.current = onClose;
	useEffect(() => {
		if (!open) return;
		const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		closeRef.current?.focus();
		const keydown = (event: KeyboardEvent) => {
			if (event.key === "Escape") { event.preventDefault(); closeHandler.current(); return; }
			if (event.key !== "Tab") return;
			const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button, input, select, [href], [tabindex]:not([tabindex='-1'])") ?? [])].filter((node) => !node.hasAttribute("disabled"));
			if (focusable.length === 0) return;
			const first = focusable[0]; const last = focusable.at(-1)!;
			if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
			else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
		};
		document.addEventListener("keydown", keydown);
		return () => { document.removeEventListener("keydown", keydown); returnFocus?.focus(); };
	}, [open, dialogRef, closeRef]);
}
