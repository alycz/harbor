import { Button } from '@harbor/ui/components/button';
import { Input } from '@harbor/ui/components/input';
import { ArrowLeft, ArrowRight, CheckCircle2, Coins, Landmark, Repeat2, ShieldAlert } from 'lucide-react';
import { useId, useState } from 'react';

import { Chip, Panel } from './workspace.tsx';

const FLOWS = [
  {
    id: 'cross-chain-swap',
    name: 'Cross-chain swap',
    action: 'Swap from another chain',
    icon: Repeat2,
    summary: 'Preview an origin-chain deposit and delivery through NEAR Intents.',
    route: 'Origin-chain asset → NEAR Intents → chosen destination',
    note: 'No wallet request, quote, deposit address, or chain transaction is created.',
  },
  {
    id: 'rhea-lend',
    name: 'Rhea lend',
    action: 'Lend with Rhea',
    icon: Landmark,
    summary: 'Preview a lending request without supplying assets.',
    route: 'Selected asset → simulated Rhea lending position',
    note: 'Rates, availability, balances, and position health are not queried.',
  },
  {
    id: 'templar-borrow',
    name: 'Templar borrow',
    action: 'Borrow with Templar',
    icon: Coins,
    summary: 'Preview a borrow request without posting collateral or creating debt.',
    route: 'Planned collateral → simulated Templar borrow request',
    note: 'Collateral ratios, rates, liquidation levels, and market availability are not modeled.',
  },
  {
    id: 'kaio-mint',
    name: 'KAIO RWA mint',
    action: 'Mint with KAIO',
    icon: ShieldAlert,
    summary: 'Preview a tokenized-asset mint request without submitting it.',
    route: 'Planned payment → simulated KAIO mint request',
    note: 'Eligibility, KYC, allowlisting, product availability, and investment terms are not checked.',
  },
] as const;

type FlowId = (typeof FLOWS)[number]['id'];
type Phase = 'configure' | 'review' | 'complete';

/**
 * A local product walkthrough for integrations that are not executable in Harbor yet.
 * It intentionally performs no network requests and produces no transaction-shaped identifiers.
 */
export function IntegrationDemo() {
  const amountId = useId();
  const [flowId, setFlowId] = useState<FlowId>('cross-chain-swap');
  const [amount, setAmount] = useState('100');
  const [phase, setPhase] = useState<Phase>('configure');
  const flow = FLOWS.find((entry) => entry.id === flowId) ?? FLOWS[0];
  const parsedAmount = Number(amount);
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;

  function choose(next: FlowId) {
    setFlowId(next);
    setPhase('configure');
  }

  function reset() {
    setAmount('100');
    setPhase('configure');
  }

  return (
    <Panel
      label="Integration walkthrough"
      icon={<Repeat2 />}
      labelId="integration-demo"
      aside={<Chip tone="warning">Demo only: no funds move</Chip>}
      bodyClassName="p-5"
    >
      <div className="rounded-lg border border-warning/30 bg-warning/8 px-3.5 py-3 text-[12.5px] text-warning">
        <p className="font-medium">Simulation only — this does not connect a wallet, call a protocol, or create a transaction.</p>
        <p className="mt-1 opacity-90">
          “Complete” below means the local walkthrough finished. It is never a chain receipt or proof of a financial action.
        </p>
      </div>

      <div className="mt-4 grid gap-2 @xl/workspace:grid-cols-2 @4xl/workspace:grid-cols-4" role="list" aria-label="Demo flows">
        {FLOWS.map((entry) => {
          const Icon = entry.icon;
          const selected = entry.id === flow.id;
          return (
            <button
              key={entry.id}
              type="button"
              role="listitem"
              aria-pressed={selected}
              onClick={() => choose(entry.id)}
              className={`rounded-xl border px-3.5 py-3 text-left transition-colors ${
                selected
                  ? 'border-[var(--ws-accent-border)] bg-[var(--harbor-accent-tint)]'
                  : 'border-border bg-background/50 hover:border-border-strong'
              }`}
            >
              <span className="flex items-center gap-2 text-[13.5px] font-medium">
                <Icon className="size-4" aria-hidden="true" />
                {entry.name}
              </span>
              <span className="mt-1 block text-[12px] leading-relaxed text-muted-foreground">{entry.summary}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 rounded-xl border border-border bg-background/40 p-4">
        {phase === 'configure' ? (
          <div className="space-y-4">
            <div>
              <p className="text-[14.5px] font-medium">{flow.action}</p>
              <p className="mt-1 text-[12.5px] text-muted-foreground">{flow.note}</p>
            </div>
            <label htmlFor={amountId} className="block max-w-sm space-y-1.5 text-[12.5px] text-muted-foreground">
              Demo amount
              <Input
                id={amountId}
                className="h-10"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(event) => setAmount(event.currentTarget.value)}
              />
            </label>
            {!amountValid ? <p className="text-[12.5px] text-destructive">Enter an amount above zero.</p> : null}
            <Button className="h-10 gap-2 px-4" disabled={!amountValid} onClick={() => setPhase('review')}>
              Review simulation <ArrowRight />
            </Button>
          </div>
        ) : null}

        {phase === 'review' ? (
          <div className="space-y-4">
            <div>
              <Chip tone="warning">Simulated review</Chip>
              <h3 className="mt-3 text-[16px] font-medium">{flow.name}</h3>
            </div>
            <dl className="grid gap-3 text-[13px] @xl/workspace:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Demo amount</dt>
                <dd className="ws-num mt-0.5 font-medium">{amount}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Illustrative route</dt>
                <dd className="mt-0.5 font-medium">{flow.route}</dd>
              </div>
              <div className="@xl/workspace:col-span-2">
                <dt className="text-muted-foreground">Not verified</dt>
                <dd className="mt-0.5">{flow.note}</dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2.5">
              <Button variant="outline" className="h-10 gap-2" onClick={() => setPhase('configure')}>
                <ArrowLeft /> Back
              </Button>
              <Button className="h-10 px-4" onClick={() => setPhase('complete')}>
                Simulate completion
              </Button>
            </div>
          </div>
        ) : null}

        {phase === 'complete' ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
              <div>
                <p className="text-[15px] font-medium">Local demo complete</p>
                <p className="mt-1 text-[12.5px] text-muted-foreground">
                  No funds moved. No wallet signature, provider request, transaction hash, position, debt, or token mint
                  was created.
                </p>
              </div>
            </div>
            <Button variant="outline" className="h-10" onClick={reset}>
              Reset demo
            </Button>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
