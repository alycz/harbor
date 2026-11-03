import type { ProposalKind } from '@harbor/agent-runtime/events';

import { SwapProposalCard } from './swap-proposal.tsx';

/** Renders the card for a proposal Harbor created, by the intent kind the agent event carried. */
export function ProposalCard({ intentId }: { intentId: string; kind: ProposalKind }) {
  return <SwapProposalCard intentId={intentId} />;
}
