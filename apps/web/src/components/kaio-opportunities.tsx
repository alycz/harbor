import { Button } from '@harbor/ui/components/button';
import { Input } from '@harbor/ui/components/input';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import {
  KAIO_CATALOG_CHECKED_AT, KAIO_CATALOG_SOURCE, KAIO_OPPORTUNITIES,
  kaioResearchPrompt, type KaioOpportunity,
} from '../lib/kaio-opportunities.ts';
import { useWallet } from '../lib/wallet.tsx';
import { Panel, SectionTitle } from './workspace.tsx';

/** Discovery only: never fabricates an investor instrument ID or a provider order. */
export function KaioOpportunities() {
  return (
    <section className="flex flex-col gap-3.5" aria-labelledby="kaio-opportunities">
      <SectionTitle id="kaio-opportunities" title="KAIO institutional funds" />
      <p className="text-sm text-muted-foreground">
        For eligible institutional/accredited investors in supported jurisdictions. Public catalog checked{' '}
        {KAIO_CATALOG_CHECKED_AT}; terms require provider confirmation. No live APY or mint quote is available here.
        {' '}<a className="ws-link" href={KAIO_CATALOG_SOURCE} target="_blank" rel="noreferrer">Official catalog</a>
      </p>
      <div className="grid gap-3 @xl/workspace:grid-cols-2">
        {KAIO_OPPORTUNITIES.map((opportunity) => <OpportunityCard key={opportunity.symbol} opportunity={opportunity} />)}
      </div>
    </section>
  );
}

function OpportunityCard({ opportunity }: { opportunity: KaioOpportunity }) {
  const { address } = useWallet();
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');

  function saveDraft() {
    if (!address) return;
    if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(amount) || amount.length > 24 || !/[1-9]/.test(amount)) {
      setMessage('Enter a positive USD estimate with at most two decimal places.');
      return;
    }
    try {
      // One replaceable local draft per signed-in account/product. No credentials,
      // investor identities, provider requests, or automatic future execution.
      sessionStorage.setItem(`harbor:kaio-draft:${address}:${opportunity.symbol}`, JSON.stringify({
        product: opportunity.symbol, estimatedUsd: amount, createdAt: new Date().toISOString(),
        status: 'local_draft_not_submitted',
      }));
      setMessage(`Saved ${opportunity.symbol} draft for this browser tab. Not submitted to KAIO; no funds moved.`);
    } catch {
      setMessage('Browser storage is unavailable. The draft was not saved.');
    }
  }

  return (
    <Panel>
      <h3 className="font-medium">{opportunity.symbol} · {opportunity.name}</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        {opportunity.category} · Published minimum ${opportunity.minimumUsd} · {opportunity.liquidity} liquidity
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Subscription setup required: eligible KAIO investor login, permitted instrument, signed agreement and provider settlement.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button nativeButton={false} render={<Link to="/chat" search={{ ask: kaioResearchPrompt(opportunity) }} />}>
          Research in Chat
        </Button>
        <a className="ws-link self-center text-sm" href="https://explorer.kaio.xyz" target="_blank" rel="noreferrer">
          View provider explorer
        </a>
      </div>
      <label className="mt-4 block text-sm" htmlFor={`kaio-amount-${opportunity.symbol}`}>Estimated subscription value (USD)</label>
      <Input id={`kaio-amount-${opportunity.symbol}`} inputMode="decimal" value={amount}
        onChange={(event) => { setAmount(event.target.value); setMessage(''); }} placeholder="Amount for research, not a payment" />
      <Button className="mt-2" variant="outline" disabled={!address} onClick={saveDraft}>Save local subscription draft</Button>
      {!address && <p className="mt-2 text-xs text-muted-foreground">Connect your Harbor wallet to save a local draft. This does not sign in to KAIO.</p>}
      <p className="mt-2 text-xs text-muted-foreground">Drafts are not executable orders and expire when this browser tab closes.</p>
      <p className="mt-2 text-sm" role="status">{message}</p>
    </Panel>
  );
}
