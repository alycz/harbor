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
        variant="ghost"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="h-9 shrink-0 gap-2 rounded-lg bg-secondary pr-2 pl-1.5 text-[14px] font-medium hover:bg-[color-mix(in_oklab,var(--harbor-sand),var(--harbor-text)_6%)] aria-expanded:bg-secondary pointer-coarse:h-11"
      >
        <AssetIcon symbol={value} className="size-6" />
        <span>{value}</span>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </Button>
      <DialogContent className="flex max-h-[calc(100dvh-40px)] flex-col gap-0 p-0 sm:max-w-[420px]">
        <div className="space-y-1 px-5 pt-5 pb-4 pr-12">
          <DialogTitle className="font-display text-[24px] leading-tight font-medium">Choose an asset</DialogTitle>
          <DialogDescription className="text-[13px] text-muted-foreground">
            Support is checked again when Harbor quotes it.
          </DialogDescription>
        </div>
        <div className="px-5 pb-3">
          <Input
            type="search"
            aria-label="Search assets"
            placeholder="Search name or symbol"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            className="h-10"
          />
        </div>
        <div className="min-h-0 overflow-y-auto border-t border-border p-2">
          {assets.map((asset) => (
            <Button
              key={asset.symbol}
              variant="ghost"
              className="h-auto min-h-14 w-full justify-start gap-3 rounded-lg px-3 py-2.5 aria-pressed:bg-secondary/70"
              aria-pressed={value === asset.symbol}
              onClick={() => {
                onChange(asset.symbol);
                setOpen(false);
                setQuery('');
              }}
            >
              <AssetIcon symbol={asset.symbol} className="size-8" />
              <span className="flex flex-1 flex-col items-start gap-0.5">
                <strong className="text-[14px] font-medium text-foreground">{asset.symbol}</strong>
                <span className="text-[12px] font-normal text-muted-foreground">{asset.name}</span>
              </span>
              {value === asset.symbol && <Check className="size-4 text-primary" />}
            </Button>
          ))}
          {assets.length === 0 && (
            <p className="py-10 text-center text-[13.5px] text-muted-foreground">No assets match this search.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
