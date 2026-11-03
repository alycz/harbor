import { Button } from '@harbor/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@harbor/ui/components/dialog';
import { Input } from '@harbor/ui/components/input';
import { Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { AssetIcon } from './asset-icon.tsx';

/** One asset the picker offers: its symbol and a line that tells same-symbol assets apart. */
export interface PickerAsset {
  symbol: string;
  name: string;
}

export function AssetPicker({
  value,
  label,
  onChange,
  options,
  disabled = false,
}: {
  value: string;
  label: string;
  onChange(value: string): void;
  options: readonly PickerAsset[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const assets = options.filter((asset) =>
    `${asset.symbol} ${asset.name}`.toLowerCase().includes(query.toLowerCase().trim()),
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <Button
        variant="outline"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="trade-token-select"
      >
        <AssetIcon symbol={value} className="size-6" />
        <span>{value}</span>
        <ChevronDown className="size-4" />
      </Button>
      <DialogContent className="harbor-workspace asset-picker-dialog flex max-h-[calc(100dvh-40px)] flex-col gap-4 p-6 sm:max-w-[440px]">
        <div className="space-y-3 pr-8">
          <p className="font-mono text-[10px] tracking-widest text-subtle uppercase">Supported assets</p>
          <DialogTitle className="font-serif text-[27px]">Choose an asset</DialogTitle>
          <DialogDescription className="sr-only">
            Choose an asset to swap. Support is checked again when Harbor quotes it.
          </DialogDescription>
        </div>
        <Input
          type="search"
          aria-label="Search assets"
          placeholder="Search name or symbol…"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          className="min-h-11"
        />
        <div className="min-h-0 overflow-y-auto">
          {assets.map((asset) => (
            <Button
              key={asset.symbol}
              variant="ghost"
              className="h-auto min-h-[62px] w-full justify-start gap-3 rounded-xl border border-transparent px-3 py-2.5"
              aria-pressed={value === asset.symbol}
              onClick={() => {
                onChange(asset.symbol);
                setOpen(false);
                setQuery('');
              }}
            >
              <AssetIcon symbol={asset.symbol} className="size-8" />
              <span className="flex flex-1 flex-col items-start gap-1">
                <strong className="font-sans text-sm font-medium text-foreground">{asset.symbol}</strong>
                <span className="font-sans text-[11px] text-subtle">{asset.name}</span>
              </span>
              {value === asset.symbol && <Check className="size-4 text-primary" />}
            </Button>
          ))}
          {assets.length === 0 && <p className="py-8 text-center text-sm text-subtle">No assets match this search.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
