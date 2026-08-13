interface Props { sizes: string[]; quantities: Record<string, number>; onChange: (size: string, pairs: number) => void }

export function SizeGrid({ sizes, quantities, onChange }: Props) {
  return <fieldset className="commerce-size-grid"><legend>Pairs by size</legend>{sizes.map((size) => <label key={size}>
    <span>Size {size}</span>
    <input aria-label={`Pairs for size ${size}`} inputMode="numeric" min="0" step="1" type="number" value={quantities[size] ?? ""} placeholder="0" onChange={(event) => onChange(size, Math.max(0, Number.parseInt(event.target.value || "0", 10)))} />
  </label>)}</fieldset>;
}
