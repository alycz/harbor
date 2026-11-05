import type { ActivityItem, Plan } from './execution.ts';

/*
 * Stand-ins Skullet measures into skeletons while the real data loads, so a skeleton takes exactly the
 * space its content will. They are never shown as content: Skullet renders them unseen and draws bars
 * over each line. Lengths match typical real values; the words themselves don't matter.
 */

const SAMPLE_ACCOUNT = 'harbor-sample-account.near';

export const SAMPLE_ACTIVITY: ActivityItem[] = [0, 1, 2].map((index) => ({
  id: `sample-${index}`,
  kind: 'swap',
  status: 'confirmed',
  createdAt: '2026-11-04T18:06:00.000Z',
  txHash: null,
  explorerUrl: 'https://nearblocks.io',
  errorCode: null,
  title: 'Swap NEAR to USDC',
  venue: 'oneclick',
  sent: [{ symbol: 'NEAR', amount: '10.5' }],
}));

export const SAMPLE_PLAN: Plan = {
  id: 'sample-plan-0000000000000000',
  kind: 'swap',
  status: 'awaiting_signature',
  network: 'mainnet',
  account: SAMPLE_ACCOUNT,
  digest: '0x0000000000000000000000000000000000000000000000000000000000000000',
  policy: { verdict: 'allow', reasons: [] },
  validUntil: null,
  approvedAt: '2026-11-04T18:06:00.000Z',
  depositAddress: null,
  oneClickStatus: null,
  deliveryVerified: false,
  txHash: null,
  explorerUrl: null,
  errorCode: null,
  quote: {
    id: 'sample-quote',
    venue: 'oneclick',
    sell: { symbol: 'NEAR', amount: '10' },
    expectedOut: { symbol: 'USDC', amount: '24.381902' },
    minimumOut: { symbol: 'USDC', amount: '24.260012' },
    slippageBps: 50,
    priceImpactBps: 12,
    protocols: [],
    harborFeeBps: 0,
    expiresAt: '2026-11-04T18:08:00.000Z',
  },
};

export const SAMPLE_ASSETS = ['NEAR', 'USDC', 'USDT', 'USDC.arb', 'USDC.base', 'USDC.eth', 'ETH', 'SOL'].map(
  (symbol) => ({ symbol, name: 'USD Coin on Ethereum' }),
);
