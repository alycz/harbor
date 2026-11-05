import { Label } from '@harbor/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@harbor/ui/components/select';
import { useId } from 'react';

const DRAFT_ASSETS = ['USDC', 'NEAR', 'USDT'];

export function AssetSelect({
  label,
  value,
  onChange,
  disabled = false,
  assets = DRAFT_ASSETS,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  assets?: readonly string[];
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-[12.5px] font-normal text-muted-foreground">
        {label}
      </Label>
      <Select disabled={disabled} value={value} onValueChange={(next) => next !== null && onChange(next)}>
        <SelectTrigger id={id} className="h-10 w-full data-[size=default]:h-10">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {assets.map((asset) => (
            <SelectItem className="min-h-9" key={asset} value={asset}>
              {asset}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
