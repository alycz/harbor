import { Label } from '@harbor/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@harbor/ui/components/select';
import { ShieldCheck } from 'lucide-react';
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
      <Label htmlFor={id}>{label}</Label>
      <Select disabled={disabled} value={value} onValueChange={(next) => next !== null && onChange(next)}>
        <SelectTrigger id={id} className="min-h-11 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {assets.map((asset) => (
            <SelectItem className="min-h-11" key={asset} value={asset}>
              {asset}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ReviewRequirements() {
  return (
    <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
      <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />A fresh quote, a passing policy check and
      your own wallet signature are required before anything executes.
    </p>
  );
}
