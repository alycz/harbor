import { RHEA_LENDING_CONTRACT } from '@harbor/adapters/rhea/lending';
import { ONE_CLICK_ASSETS } from '@harbor/domain/oneclick-assets';
import { describe, expect, it } from 'vitest';

import { readLiveEarn } from '../src/markets/live.ts';

const USDC = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';

function chainBytes(value: unknown) {
  return JSON.stringify({ result: { result: [...new TextEncoder().encode(JSON.stringify(value))] } });
}

/** Answers like each upstream did on 2026-11-15. `fail` names hosts that answer with a server error. */
function upstreams(fail: string[] = []) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (fail.includes(url.host)) return new Response('down', { status: 503 });
    if (url.host === 'blue-api.morpho.org') {
      return Response.json({
        data: { vaultByAddress: { state: { totalAssetsUsd: 398_513_580.13, netApy: 0.04502 } } },
      });
    }
    if (url.host === 'explorer.portals.fi') {
      return new Response('---\nsymbol: "TLO"\napy: 0.06663\nbase_apy: 0.06663\ntvl_usd: 3791305.31\n---\n');
    }
    const body = JSON.parse(String(init?.body)) as { params: { account_id: string; args_base64: string } };
    const args = JSON.parse(atob(body.params.args_base64)) as { token_id: string };
    if (body.params.account_id !== RHEA_LENDING_CONTRACT) return new Response('{}', { status: 400 });
    // Only USDC is listed in this fake; other tokens fail like an unknown asset does.
    if (args.token_id !== USDC) return Response.json({ error: { message: 'unknown asset' } });
    return new Response(
      chainBytes({
        token_id: USDC,
        supplied: { balance: '12175654532026803451228896' },
        supply_apr: '0.117260931641168647809485079',
        config: { can_deposit: true, can_withdraw: true, extra_decimals: 12 },
      }),
    );
  }) as typeof fetch;
}

describe('live Earn figures', () => {
  it('reads Rhea from the contract and each vault from its own source, in whole units and percent', async () => {
    const live = await readLiveEarn('https://rpc.mainnet.near.org', ONE_CLICK_ASSETS, upstreams());
    expect(live.rhea).toEqual([
      {
        assetId: `nep141:${USDC}`,
        symbol: 'USDC',
        tokenId: USDC,
        supplyAprPct: expect.closeTo(11.726, 3),
        supplied: 12_175_654.53,
        canDeposit: true,
        canWithdraw: true,
      },
    ]);
    expect(live.vaults).toEqual([
      expect.objectContaining({ receipt: 'gtUSDCp', apyPct: expect.closeTo(4.502, 3), tvlUsd: 398_513_580.13 }),
      expect.objectContaining({ receipt: 'TLO', apyPct: expect.closeTo(6.663, 3), tvlUsd: 3_791_305.31 }),
    ]);
  });

  it('keeps the other sources when one upstream is down', async () => {
    const live = await readLiveEarn(
      'https://rpc.mainnet.near.org',
      ONE_CLICK_ASSETS,
      upstreams(['blue-api.morpho.org']),
    );
    expect(live.vaults.map((vault) => vault.receipt)).toEqual(['TLO']);
    expect(live.rhea).toHaveLength(1);
  });
});
