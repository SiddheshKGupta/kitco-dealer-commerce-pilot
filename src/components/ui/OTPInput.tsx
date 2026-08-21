import { useEffect, useRef } from "react";

interface OTPInputProps {
	value: string;
	onChange: (value: string) => void;
	label?: string;
}

/** Single wide numeric field rather than six boxes — one native input means paste,
 *  autofill (autocomplete="one-time-code") and the numeric keypad all work for free. */
export function OTPInput({ value, onChange, label = "Verification code" }: OTPInputProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	useEffect(() => { inputRef.current?.focus(); }, []);
	return <input
		ref={inputRef}
		className="ui-otp-input"
		aria-label={label}
		inputMode="numeric"
		autoComplete="one-time-code"
		maxLength={6}
		value={value}
		onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
		placeholder="000000"
	/>;
}
