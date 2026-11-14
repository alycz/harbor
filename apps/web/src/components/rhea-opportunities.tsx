import { Button } from '@harbor/ui/components/button';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { call } from '../lib/execution.ts';
import { useWallet } from '../lib/wallet.tsx';
import { Panel } from './workspace.tsx';

type Opportunity = { assetId: string; tokenId: string; symbol: string; protocol: string; network: string };
type Discovery = { opportunities: Opportunity[]; unavailable: string[]; observedAt: string; executionEnabled: boolean };

/** Live market availability, deliberately not a fabricated yield ranking or a transaction approval. */
export function RheaOpportunities() {
  const wallet = useWallet();
  const [data, setData] = useState<Discovery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    if (wallet.address) {
      void call<Discovery>('/api/lending/rhea/opportunities')
        .then((result) => {
          if (active) setData(result);
        })
        .catch(() => {
          if (active) setError('Rhea markets could not be checked. No availability is assumed.');
        });
    }
    return () => {
      active = false;
    };
  }, [wallet.address, refresh]);
  return (
    <Panel>
      <section aria-labelledby="rhea-opportunities" className="flex flex-col gap-3">
        <h2 id="rhea-opportunities" className="text-lg font-medium">
          Rhea lending opportunities
        </h2>
        <p className="text-sm text-muted-foreground">
          Live supply availability on NEAR. Rates are not available here. Research risks in Chat before choosing an
          amount; research never approves a transaction.
        </p>
        {!wallet.address ? (
          <p>Connect and sign in to inspect live markets.</p>
        ) : (
          <>
            <Button variant="outline" onClick={() => setRefresh((value) => value + 1)}>
              Refresh markets
            </Button>
            {error && <p role="alert">{error}</p>}
            {!data && !error && <p role="status">Checking Rhea’s on-chain markets…</p>}
            {data && (
              <>
                <p className="text-xs text-muted-foreground">
                  Checked {new Date(data.observedAt).toLocaleString()}.{' '}
                  {data.executionEnabled
                    ? 'Wallet approval required for every supply.'
                    : 'Execution disabled; research and previews only.'}
                </p>
                {data.unavailable.length > 0 && (
                  <p className="text-sm">
                    {data.unavailable.length} asset checks unavailable. This list may be incomplete.
                  </p>
                )}
                {data.opportunities.length === 0 && (
                  <p>No supply-enabled markets were verified for Harbor’s registered assets.</p>
                )}
                <ul className="grid list-none gap-3 md:grid-cols-2">
                  {data.opportunities.map((market) => (
                    <li key={market.assetId} className="rounded-lg border p-4">
                      <h3 className="font-medium">Supply {market.symbol} on Rhea</h3>
                      <p className="break-all text-xs text-muted-foreground">{market.tokenId}</p>
                      <p className="my-2 text-sm">
                        Supply only, not collateral. Variable returns and smart-contract risk. APY unavailable.
                      </p>
                      <Button
                        nativeButton={false}
                        variant="outline"
                        render={
                          <Link
                            to="/chat"
                            search={{
                              ask: `Research supplying ${market.symbol} on Rhea lending, NEAR mainnet. Protocol: rhea-lending. Canonical asset ID: ${market.assetId}. Token contract: ${market.tokenId}. Explain current yield, liquidity, smart-contract and withdrawal risks using verified sources. Ask me for an amount before queueing a supply transaction. Do not execute or approve anything from this research request.`,
                            }}
                          />
                        }
                      >
                        Research in Chat
                      </Button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>
    </Panel>
  );
}
