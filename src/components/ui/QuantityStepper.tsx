import { IconButton } from "./IconButton";

interface QuantityStepperProps {
	value: number;
	onChange: (value: number) => void;
	label: string;
	min?: number;
	max?: number;
	step?: number;
}

export function QuantityStepper({ value, onChange, label, min = 0, max, step = 1 }: QuantityStepperProps) {
	const clamp = (next: number) => Math.max(min, max === undefined ? next : Math.min(max, next));
	return <div className="ui-stepper" role="group" aria-label={label}>
		<IconButton label={`Decrease ${label}`} size="sm" className="ui-stepper-btn" onClick={() => onChange(clamp(value - step))} disabled={value <= min}>−</IconButton>
		<input
			className="ui-stepper-value"
			inputMode="numeric"
			aria-label={label}
			value={value}
			onChange={(event) => onChange(clamp(Number.parseInt(event.target.value.replace(/\D/g, "") || "0", 10)))}
		/>
		<IconButton label={`Increase ${label}`} size="sm" className="ui-stepper-btn" onClick={() => onChange(clamp(value + step))} disabled={max !== undefined && value >= max}>+</IconButton>
	</div>;
}
