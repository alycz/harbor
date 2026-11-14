import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@harbor/ui/components/select';
import type { ReactNode } from 'react';

import { AssetIcon } from './asset-icon.tsx';

/** One choice in an asset dropdown: the value it sets, the token's symbol and what tells it apart. */
export interface AssetChoice {
  value: string;
  symbol: string;
  /** The chain or the full name, shown under the symbol. */
  detail: string;
}

const CHAIN_NAMES: Record<string, string> = {
  near: 'NEAR',
  eth: 'Ethereum',
  base: 'Base',
  arb: 'Arbitrum',
  sol: 'Solana',
};

/** A chain code as people say it: "base" → "Base". */
export function chainName(code: string): string {
  return CHAIN_NAMES[code] ?? code.charAt(0).toUpperCase() + code.slice(1);
}

const TRIGGER =
  'h-10 w-full gap-2.5 rounded-md border-input bg-card pr-3 pl-2.5 text-[13.5px] font-medium data-[size=default]:h-10';

/** The workspace's asset dropdown: each token with its icon, symbol and chain, in the shared Select. */
export function AssetSelect({
  id,
  value,
  onChange,
  choices,
  placeholder = 'Choose an asset',
  disabled = false,
  label,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  choices: readonly AssetChoice[];
  placeholder?: string;
  disabled?: boolean;
  /** For assistive technology when no visible label points at `id`. */
  label?: string;
}) {
  const current = choices.find((choice) => choice.value === value);
  return (
    <Select value={value || null} onValueChange={(next) => next !== null && onChange(String(next))} disabled={disabled}>
      <SelectTrigger id={id} aria-label={label} className={TRIGGER}>
        <SelectValue>
          {current ? (
            <ChoiceLine
              icon={<AssetIcon symbol={current.symbol} className="size-5" />}
              title={current.symbol}
              detail={current.detail}
            />
          ) : (
            <span className="font-normal text-muted-foreground">{placeholder}</span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-80 min-w-64 p-1.5">
        {choices.map((choice) => (
          <SelectItem key={choice.value} value={choice.value} className="min-h-11 rounded-md py-2 pr-9 pl-2.5">
            <ChoiceLine
              icon={<AssetIcon symbol={choice.symbol} className="size-6" />}
              title={choice.symbol}
              detail={choice.detail}
            />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A two-asset pair dropdown, both token icons overlapping, for monitors that watch one pair. */
export function PairSelect({
  id,
  value,
  onChange,
  pairs,
  detail,
}: {
  id?: string;
  value: number;
  onChange: (value: number) => void;
  pairs: readonly { base: string; quote: string }[];
  detail: string;
}) {
  const icons = (pair: { base: string; quote: string }, size: string) => (
    <span className="flex shrink-0 -space-x-1.5">
      <span className="rounded-full bg-card p-px">
        <AssetIcon symbol={pair.base} className={size} />
      </span>
      <span className="rounded-full bg-card p-px">
        <AssetIcon symbol={pair.quote} className={size} />
      </span>
    </span>
  );
  const current = pairs[value];
  return (
    <Select value={String(value)} onValueChange={(next) => next !== null && onChange(Number(next))}>
      <SelectTrigger id={id} className={TRIGGER}>
        <SelectValue>
          {current ? <ChoiceLine icon={icons(current, 'size-5')} title={`${current.base} / ${current.quote}`} /> : null}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="min-w-64 p-1.5">
        {pairs.map((pair, index) => (
          <SelectItem
            key={`${pair.base}/${pair.quote}`}
            value={String(index)}
            className="min-h-11 rounded-md py-2 pr-9 pl-2.5"
          >
            <ChoiceLine icon={icons(pair, 'size-6')} title={`${pair.base} / ${pair.quote}`} detail={detail} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ChoiceLine({ icon, title, detail }: { icon: ReactNode; title: string; detail?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {icon}
      <span className="min-w-0 truncate">
        <span className="font-medium text-foreground">{title}</span>
        {detail ? <span className="ml-1.5 text-[12.5px] font-normal text-muted-foreground">{detail}</span> : null}
      </span>
    </span>
  );
}
