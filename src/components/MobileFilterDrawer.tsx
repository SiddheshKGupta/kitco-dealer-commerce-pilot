import { BottomSheet, Button } from "./ui";
import { FilterRail, type FilterGroup, type MrpRange, type MrpSelection } from "./FilterRail";

interface Props {
  open: boolean;
  groups: FilterGroup[];
  selected: Record<string, string[]>;
  onToggle: (groupKey: string, value: string) => void;
  mrpBounds: MrpRange | null;
  mrpSelected: MrpSelection;
  onMrpChange: (selection: MrpSelection) => void;
  onClearAll: () => void;
  totalSelected: number;
  onClose: () => void;
}

export function MobileFilterDrawer({ open, groups, selected, onToggle, mrpBounds, mrpSelected, onMrpChange, onClearAll, totalSelected, onClose }: Props) {
  return <BottomSheet open={open} onClose={onClose} title="Refine products" footer={<Button full onClick={onClose}>Show products</Button>}>
    <FilterRail groups={groups} selected={selected} onToggle={onToggle} mrpBounds={mrpBounds} mrpSelected={mrpSelected} onMrpChange={onMrpChange} onClearAll={onClearAll} totalSelected={totalSelected} />
  </BottomSheet>;
}
