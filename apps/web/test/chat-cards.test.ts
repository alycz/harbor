import assert from 'node:assert/strict';
import test from 'node:test';

import type { DataCard } from '@harbor/agent-runtime/events';
import { arrangeCards } from '../src/lib/chat-cards.ts';

const pools = (cardId: string, assets: string[]) => ({
  cardId,
  card: {
    kind: 'yield_pools',
    capturedAt: null,
    items: assets.map((asset) => ({ project: 'aave-v3', chain: 'Ethereum', asset, apyPct: 3, tvlUsd: 1 })),
  } satisfies DataCard,
});
const deposits = (cardId: string, rate: number) => ({
  cardId,
  card: {
    kind: 'deposits',
    fetchedAt: '2026-11-15T00:00:00.000Z',
    items: [
      {
        name: 'Rhea Lend USDC',
        protocol: 'rhea-lending',
        chain: 'NEAR',
        asset: 'USDC',
        ratePct: rate,
        rateKind: 'APR',
        sizeUsd: 1,
      },
    ],
  } satisfies DataCard,
});

test('live deposits lead, and a tool called twice shows once', () => {
  const arranged = arrangeCards([
    pools('p1', ['USDC', 'WETH']),
    deposits('d1', 12),
    pools('p2', ['WETH', 'USDT']),
    deposits('d2', 13),
  ]);
  assert.deepEqual(
    arranged.map((entry) => entry.card.kind),
    ['deposits', 'yield_pools'],
  );
  // The latest live reading wins; snapshot pools merge without repeats, first seen first.
  assert.equal(arranged[0]?.card.kind === 'deposits' && arranged[0].card.items[0]?.ratePct, 13);
  assert.deepEqual(arranged[1]?.card.kind === 'yield_pools' && arranged[1].card.items.map((item) => item.asset), [
    'USDC',
    'WETH',
    'USDT',
  ]);
});
