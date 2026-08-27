import { sizeSystemDisplayLabel } from "../domain/order-sizes";
import { QuantityStepper } from "./ui";

interface Props { sizes: string[]; quantities: Record<string, number>; onChange: (size: string, pairs: number) => void; sizeSystemLabel?: string | null }

export function SizeGrid({ sizes, quantities, onChange, sizeSystemLabel }: Props) {
  return <fieldset className="commerce-size-grid">
    <legend>Pairs by size</legend>
    <p className="commerce-size-system">Size system: {sizeSystemDisplayLabel(sizeSystemLabel)}</p>
    {sizes.map((size) => <div className="commerce-size-row" key={size}>
      <span>Size {size}</span>
      <QuantityStepper label={`Pairs for size ${size}`} value={quantities[size] ?? 0} onChange={(next) => onChange(size, next)} />
    </div>)}
  </fieldset>;
}
