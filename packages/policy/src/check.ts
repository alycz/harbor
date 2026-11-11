import { type Decision, evaluate, type Rule } from './engine.ts';
import { type Destination, isOwnAddress, ownAddresses, type Policy } from './policy.ts';

const DAY_MS = 24 * 60 * 60_000;

/** A signed policy as Harbor holds it: the body the owner signed, and where it stands now. */
export interface SignedPolicy {
  id: string;
  body: Policy;
  status: 'active' | 'frozen' | 'revoked' | 'superseded';
  signedAtMs: number;
}

/** One proposed action, with what the owner has already spent under the policy. */
export interface ActionFacts {
  nowMs: number;
  /** Who proposed it. The schedule only limits the agent; the owner can act whenever they like. */
  byAgent: boolean;
  sellAsset: string;
  buyAsset: string;
  amountInRaw: bigint;
  recipient: Destination;
  slippageBps: number;
  quoteObservedAtMs: number;
  /** Raw amounts of the sell asset already committed: in the last 24 hours, and since the policy was signed. */
  spentLastDayRaw: bigint;
  spentSinceSignedRaw: bigint;
  /** When the agent last acted on its own under this policy, if ever. */
  lastAgentActionMs: number | null;
}

interface Facts extends ActionFacts {
  policy: SignedPolicy;
}

const RULES: readonly Rule<Facts>[] = [
  {
    id: 'policy_live',
    severity: 'block',
    check: ({ policy }) => ({
      pass: policy.status === 'active',
      code: policy.status === 'frozen' ? 'POLICY_FROZEN' : 'POLICY_NOT_ACTIVE',
      detail:
        policy.status === 'frozen'
          ? 'You froze your policy, so the agent cannot act until you sign it again.'
          : 'This policy is no longer active. Sign a new one.',
    }),
  },
  {
    id: 'policy_window',
    severity: 'block',
    check: ({ policy, nowMs }) => {
      const starts = Date.parse(policy.body.validFrom);
      const ends = Date.parse(policy.body.expiresAt);
      return {
        pass: nowMs >= starts && nowMs < ends,
        code: nowMs < starts ? 'POLICY_NOT_STARTED' : 'POLICY_EXPIRED',
        detail: nowMs < starts ? 'Your policy has not started yet.' : 'Your policy has expired. Sign a new one.',
        facts: { validFrom: policy.body.validFrom, expiresAt: policy.body.expiresAt },
      };
    },
  },
  {
    id: 'assets_allowed',
    severity: 'block',
    check: ({ policy, sellAsset, buyAsset }) => {
      const missing = [sellAsset, buyAsset].filter((asset) => !policy.body.allowedAssets.includes(asset));
      return {
        pass: missing.length === 0,
        code: 'ASSET_NOT_ALLOWED',
        detail: 'This trades an asset your policy does not allow.',
        facts: { missing: missing.join(', ') },
      };
    },
  },
  {
    id: 'destination_signed',
    severity: 'block',
    check: ({ policy, recipient }) => ({
      pass: isOwnAddress(ownAddresses(policy.body, policy.body.owner), recipient),
      code: 'DESTINATION_NOT_SIGNED',
      detail: `${recipient.address} on ${recipient.chain} is not one of the addresses you signed. Funds only go to your own addresses.`,
      facts: { recipient: recipient.address, chain: recipient.chain },
    }),
  },
  {
    id: 'per_action_limit',
    severity: 'block',
    check: ({ policy, sellAsset, amountInRaw }) => {
      const limit = limitFor(policy, sellAsset);
      return {
        pass: limit !== null && amountInRaw <= BigInt(limit.perActionMaxRaw),
        code: limit ? 'PER_ACTION_LIMIT' : 'SPEND_NOT_ALLOWED',
        detail: limit
          ? 'This is more than your policy allows in one action.'
          : 'Your policy does not let the agent spend this asset.',
        facts: { amountInRaw: amountInRaw.toString(), limitRaw: limit?.perActionMaxRaw ?? 'none' },
      };
    },
  },
  {
    id: 'daily_limit',
    severity: 'block',
    check: ({ policy, sellAsset, amountInRaw, spentLastDayRaw }) => {
      const limit = limitFor(policy, sellAsset);
      return {
        pass: limit !== null && spentLastDayRaw + amountInRaw <= BigInt(limit.dailyMaxRaw),
        code: 'DAILY_LIMIT',
        detail: 'This would take you over your daily limit for this asset.',
        facts: { spentLastDayRaw: spentLastDayRaw.toString(), limitRaw: limit?.dailyMaxRaw ?? 'none' },
      };
    },
  },
  {
    id: 'total_budget',
    severity: 'block',
    check: ({ policy, sellAsset, amountInRaw, spentSinceSignedRaw }) => {
      const limit = limitFor(policy, sellAsset);
      return {
        pass: limit !== null && spentSinceSignedRaw + amountInRaw <= BigInt(limit.totalMaxRaw),
        code: 'BUDGET_EXCEEDED',
        detail: 'This would take you over the total budget you signed for this asset.',
        facts: { spentSinceSignedRaw: spentSinceSignedRaw.toString(), limitRaw: limit?.totalMaxRaw ?? 'none' },
      };
    },
  },
  {
    id: 'slippage_limit',
    severity: 'block',
    check: ({ policy, slippageBps }) => ({
      pass: slippageBps <= policy.body.slippageMaxBps,
      code: 'SLIPPAGE_ABOVE_POLICY',
      detail: `Slippage of ${slippageBps / 100}% is above the ${policy.body.slippageMaxBps / 100}% you signed.`,
    }),
  },
  {
    id: 'quote_age',
    severity: 'block',
    check: ({ policy, nowMs, quoteObservedAtMs }) => ({
      pass: nowMs - quoteObservedAtMs <= policy.body.quoteMaxAgeSeconds * 1000,
      code: 'QUOTE_TOO_OLD',
      detail: 'The quote is older than your policy accepts.',
    }),
  },
  {
    id: 'agent_schedule',
    severity: 'block',
    check: ({ policy, byAgent, nowMs, lastAgentActionMs }) => {
      const { schedule } = policy.body;
      const due =
        !byAgent ||
        lastAgentActionMs === null ||
        (schedule.kind === 'interval' && nowMs - lastAgentActionMs >= schedule.everySeconds * 1000);
      return {
        pass: due,
        code: 'SCHEDULE_NOT_DUE',
        detail: 'Your policy does not let the agent act again yet.',
      };
    },
  },
];

/**
 * Whether one action fits the owner's signed policy. `allow` or `warn` means the agent may act on its
 * own; `block` means the action comes back to the owner for approval. With no signed policy, every
 * action comes back to the owner.
 */
export function checkAction(policy: SignedPolicy | null, facts: ActionFacts): Decision {
  if (!policy) {
    return {
      verdict: 'block',
      reasons: [
        {
          rule: 'policy_signed',
          severity: 'block',
          pass: false,
          code: 'NO_POLICY',
          detail: 'You have not signed a policy, so Harbor asks you before every action.',
        },
      ],
    };
  }
  return evaluate(RULES, { ...facts, policy });
}

/** Which part of a 24-hour window an approval falls in: the start of that window. */
export function dayWindowStart(nowMs: number): number {
  return nowMs - DAY_MS;
}

function limitFor(policy: SignedPolicy, assetId: string) {
  return policy.body.spend.find((limit) => limit.assetId === assetId) ?? null;
}
