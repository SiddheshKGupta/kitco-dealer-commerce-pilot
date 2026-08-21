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
	return <div className="ui-stepper" role="group">
		{/* No group-level aria-label: it would duplicate the input's own label below and
		    make getByLabelText-style label queries match two elements for the same name. */}
		<IconButton label={`Decrease ${label}`} className="ui-stepper-btn" onClick={() => onChange(clamp(value - step))} disabled={value <= min}>−</IconButton>
		<input
			className="ui-stepper-value"
			inputMode="numeric"
			aria-label={label}
			value={value}
			onChange={(event) => onChange(clamp(Number.parseInt(event.target.value.replace(/\D/g, "") || "0", 10)))}
		/>
		<IconButton label={`Increase ${label}`} className="ui-stepper-btn" onClick={() => onChange(clamp(value + step))} disabled={max !== undefined && value >= max}>+</IconButton>
	</div>;
}
