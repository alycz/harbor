import type { AgentEvent } from '@earendil-works/pi-agent-core';

/** Actions an agent proposal can carry; the browser picks the card by kind. */
export const PROPOSAL_KINDS = ['swap'] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export type ProtocolAction =
  | { protocol: 'rhea-lending'; assetId: string; amount: string }
  | { protocol: 'templar'; marketId: string; amountAtomic: string };

/**
 * Data a read tool returned, for the browser to show as cards. Built by the application from the tool's
 * own result, never from model text; the model's prose may summarize it but cannot change it.
 */
export type DataCard =
  | {
      kind: 'deposits';
      fetchedAt: string;
      items: {
        name: string;
        protocol: 'rhea-lending' | 'oneclick-vault';
        chain: string;
        asset: string;
        ratePct: number;
        rateKind: 'APR' | 'APY';
        sizeUsd: number;
      }[];
    }
  | {
      kind: 'borrow_markets';
      items: {
        marketId: string;
        borrow: { symbol: string | null; chain: string | null };
        collateral: { symbol: string | null; chain: string | null };
      }[];
    }
  | {
      kind: 'yield_pools';
      capturedAt: string | null;
      items: { project: string; chain: string; asset: string; apyPct: number | null; tvlUsd: number | null }[];
    };

/** The only agent events that reach the browser. Hidden reasoning, prompts and raw arguments never do. */
export type PublicAgentEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_started'; toolCallId: string; name: string }
  | { type: 'tool_completed'; toolCallId: string; name: string; isError: boolean }
  /** An application-created proposal the browser renders from its own records, never from model text. */
  | { type: 'proposal'; kind: ProposalKind; intentId: string }
  | { type: 'protocol_action'; actionId: string; action: ProtocolAction }
  | { type: 'data_card'; cardId: string; card: DataCard }
  | { type: 'settled' }
  /** `stopped`: the user stopped it. `lost`: the process running it went away. */
  | { type: 'interrupted'; reason: 'stopped' | 'lost' }
  /** `provider_unavailable`: the model provider refused or failed; retrying later can work. */
  | { type: 'error'; code: 'provider_unavailable' | 'deadline' | 'failed'; message: string };

export function toPublicEvent(event: AgentEvent): PublicAgentEvent | null {
  switch (event.type) {
    case 'message_update':
      return event.assistantMessageEvent.type === 'text_delta'
        ? { type: 'text_delta', delta: event.assistantMessageEvent.delta }
        : null;
    case 'tool_execution_start':
      return { type: 'tool_started', toolCallId: event.toolCallId, name: event.toolName };
    case 'tool_execution_end':
      return { type: 'tool_completed', toolCallId: event.toolCallId, name: event.toolName, isError: event.isError };
    default:
      return null;
  }
}

export function isTerminal(event: PublicAgentEvent): boolean {
  return event.type === 'settled' || event.type === 'interrupted' || event.type === 'error';
}
