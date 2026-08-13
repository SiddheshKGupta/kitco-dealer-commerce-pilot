import { useEffect, useRef } from "react";

interface OtpInputProps {
	value: string;
	onChange: (value: string) => void;
}

export function OtpInput({ value, onChange }: OtpInputProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	useEffect(() => { inputRef.current?.focus(); }, []);
	return <input ref={inputRef} className="otp-input" aria-label="Verification code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={value} onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" />;
}
