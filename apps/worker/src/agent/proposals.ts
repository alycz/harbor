import { compareIntent } from '../execution/lifecycle.ts';
import { executionDeps } from '../execution/store.ts';
import { createSwapIntent } from '../execution/swap.ts';
import type { ProposalService } from './tools.ts';

/** The agent's only path into execution: create an intent and get quotes for the user to review. */
export function createProposalService(env: Env): ProposalService {
  return {
    async proposeSwap(input) {
      const deps = executionDeps(env);
      const intent = await createSwapIntent(deps, { ...input, source: 'chat' });
      try {
        const { quotes } = await compareIntent(deps, intent.id);
        const quote = quotes[0];
        if (!quote) throw new Error('No quote was returned.');
        return {
          intentId: intent.id,
          sell: { symbol: intent.sell.symbol, amount: intent.sell.amount },
          buy: { symbol: intent.buy.symbol },
          quote: {
            expectedOut: quote.expectedOut.amount,
            minimumOut: quote.minimumOut.amount,
            slippageBps: quote.slippageBps,
            priceImpactBps: quote.priceImpactBps,
            protocols: quote.protocols,
          },
        };
      } catch (error) {
        return {
          intentId: intent.id,
          sell: { symbol: intent.sell.symbol, amount: intent.sell.amount },
          buy: { symbol: intent.buy.symbol },
          quote: { unavailable: error instanceof Error ? error.message : 'quote failed' },
        };
      }
    },
  };
}
