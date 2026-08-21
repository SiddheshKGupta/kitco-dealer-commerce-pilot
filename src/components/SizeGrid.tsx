import { QuantityStepper } from "./ui";

interface Props { sizes: string[]; quantities: Record<string, number>; onChange: (size: string, pairs: number) => void }

export function SizeGrid({ sizes, quantities, onChange }: Props) {
  return <fieldset className="commerce-size-grid"><legend>Pairs by size</legend>{sizes.map((size) => <div className="commerce-size-row" key={size}>
    <span>Size {size}</span>
    <QuantityStepper label={`Pairs for size ${size}`} value={quantities[size] ?? 0} onChange={(next) => onChange(size, next)} />
  </div>)}</fieldset>;
}
