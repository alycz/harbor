import type { AgentTool } from '@earendil-works/pi-agent-core';
import { defineTool, type ToolOutput, untrusted } from '@harbor/agent-runtime/tools';
import { parseResearchSnapshot } from '@harbor/data/research';
import { Type } from 'typebox';

import snapshotJson from '../../../../research/data/research-snapshot.json' with { type: 'json' };

export const APPROVED_TOOLS = ['list_markets', 'propose_intent'] as const;

interface SwapProposal {
  intentId: string;
  sell: { symbol: string; amount: string };
  buy: { symbol: string };
  quote:
    | {
        expectedOut: string;
        minimumOut: string;
        slippageBps: number;
        priceImpactBps: number | null;
        protocols: string[];
      }
    | { unavailable: string };
}

/** Creates application records only; it can never approve, sign or submit. */
export interface ProposalService {
  proposeSwap(input: { sell: string; buy: string; amount: string }): Promise<SwapProposal>;
}

const DEFAULT_LIMIT = 10;
const SYMBOL_PATTERN = '^[A-Za-z0-9.$-]{1,16}$';
const research = parseResearchSnapshot(snapshotJson);

export function createTools(deps: { proposals: ProposalService }): AgentTool[] {
  return [
    defineTool({
      name: 'list_markets',
      label: 'Reading the research snapshot',
      description:
        'List DeFi protocols by TVL, or yield pools across chains sorted by APY or TVL, from the dated research snapshot. Not live data.',
      parameters: Type.Object({
        kind: Type.Union([Type.Literal('protocols'), Type.Literal('yield_pools')]),
        chain: Type.Optional(Type.String({ maxLength: 32, description: 'Keep one chain, such as Near or Ethereum.' })),
        category: Type.Optional(
          Type.String({ maxLength: 40, description: 'Protocols only: a category to keep, such as Lending or Dexs.' }),
        ),
        symbol: Type.Optional(Type.String({ maxLength: 32, description: 'Yield pools only: an asset such as USDC.' })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 25 })),
        sort: Type.Optional(
          Type.Union([Type.Literal('tvl'), Type.Literal('apy')], {
            description: 'Yield pools only: highest total APY or highest TVL first. Protocols always sort by TVL.',
          }),
        ),
      }),
      replay: 'safe',
      run: async ({ kind, chain, category, symbol, limit, sort }) => {
        const count = limit ?? DEFAULT_LIMIT;
        const onChain = (name: string) => !chain || name.toLowerCase() === chain.toLowerCase();
        const rows =
          kind === 'protocols'
            ? research.protocols
                .filter((row) => !category || row.category.toLowerCase() === category.toLowerCase())
                .filter((row) => !chain || row.chains.some(onChain))
                .sort((left, right) => (right.allChainsTvlUsd ?? -1) - (left.allChainsTvlUsd ?? -1))
                .slice(0, count)
                .map((row) => ({
                  name: row.name,
                  category: row.category,
                  chains: row.chains,
                  allChainsTvlUsd: row.allChainsTvlUsd,
                  changeOneDayPct: row.change.day,
                  observedAt: row.observedAt,
                }))
            : research.yieldPools
                .filter((row) => onChain(row.chain))
                .filter((row) => !symbol || row.symbol.toUpperCase().split('-').includes(symbol.toUpperCase()))
                .sort((left, right) =>
                  sort === 'apy'
                    ? (right.totalApyPct ?? -1) - (left.totalApyPct ?? -1)
                    : (right.tvlUsd ?? -1) - (left.tvlUsd ?? -1),
                )
                .slice(0, count)
                .map((row) => ({
                  chain: row.chain,
                  project: row.project,
                  asset: row.symbol,
                  tvlUsd: row.tvlUsd,
                  baseApyPct: row.baseApyPct,
                  rewardApyPct: row.rewardApyPct,
                  totalApyPct: row.totalApyPct,
                  observedAt: row.observedAt,
                }));
        const sources = research.sources.map((source) => ({ name: source.attribution, capturedAt: source.capturedAt }));
        const body = JSON.stringify({ sources, live: false, rows });
        return { text: untrusted('research snapshot', body), details: { kind, rows: rows.length } };
      },
    }),
    defineTool({
      name: 'propose_intent',
      label: 'Preparing a proposal',
      description: [
        'Propose a swap for the user to review: sell one supported asset for another (sell, buy, amount as',
        'symbols such as NEAR or USDC). Harbor gets a live quote. The user sees a proposal card, reviews the',
        'exact terms and signs in their own wallet. You cannot approve, sign or submit. Explain the result from',
        'the tool output; do not compute amounts or rates yourself.',
      ].join(' '),
      parameters: Type.Object({
        kind: Type.Literal('swap'),
        amount: Type.String({
          pattern: '^(0|[1-9][0-9]*)([.][0-9]{1,24})?$',
          maxLength: 40,
          description: 'Plain decimal such as "100": the amount sold.',
        }),
        sell: Type.String({ pattern: SYMBOL_PATTERN, description: 'The asset sold.' }),
        buy: Type.String({ pattern: SYMBOL_PATTERN, description: 'The asset bought.' }),
      }),
      // It creates a record, so a crash never repeats it.
      replay: 'never',
      sequential: true,
      run: async (args) => {
        try {
          return swapOutput(await deps.proposals.proposeSwap({ sell: args.sell, buy: args.buy, amount: args.amount }));
        } catch (error) {
          return { text: error instanceof Error ? error.message : 'The action could not be proposed.', isError: true };
        }
      },
    }),
  ];
}

function swapOutput(proposal: SwapProposal): ToolOutput {
  const quote = proposal.quote;
  const summary =
    'unavailable' in quote
      ? `The live quote is unavailable right now (${quote.unavailable}); the proposal card will retry.`
      : [
          `Expected about ${quote.expectedOut} ${proposal.buy.symbol}, at least ${quote.minimumOut} after`,
          `${quote.slippageBps / 100}% slippage. Price impact: ${quote.priceImpactBps === null ? 'not reported' : `${quote.priceImpactBps / 100}%`}.`,
          `Routes: ${quote.protocols.join(', ') || 'not reported'}. Harbor fee: 0. The quote is valid for about 30 seconds and the card refreshes it.`,
        ].join(' ');
  return {
    text: `Swap proposal ready: sell ${proposal.sell.amount} ${proposal.sell.symbol} for ${proposal.buy.symbol}. ${summary} The user reviews and signs in their wallet; nothing executes until they do.`,
    details: { intentId: proposal.intentId, kind: 'swap' },
  };
}
