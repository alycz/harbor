import type { SettlementReport, SwapExecutor } from '@harbor/adapters/venue';
import type { NearChain } from '@harbor/near/chain';

import type { EvmReader } from '../src/execution/delivery.ts';

/** What the fake provider, NEAR and the EVM chains answer; tests change these as a swap moves on. */
interface FakeWorld {
  amountOut: bigint;
  minOut: bigint;
  report: SettlementReport | Error;
  /** NEAR transactions by hash, in the shape the `tx` RPC returns; `down` makes every read fail. */
  transactions: Map<string, unknown>;
  balances: Map<string, bigint>;
  receipts: Map<string, unknown>;
  down: boolean;
  quotes: { refundTo: string; recipient: string; amountIn: bigint }[];
  notices: { txHash: string; sender: string }[];
}

export function fakeWorld(clock: { now: number }, amountOut = 26_000_000_000_000_000_000_000_000n) {
  const world: FakeWorld = {
    amountOut,
    minOut: (amountOut * 995n) / 1000n,
    report: report('PENDING_DEPOSIT'),
    transactions: new Map(),
    balances: new Map(),
    receipts: new Map(),
    down: false,
    quotes: [],
    notices: [],
  };
  const executor: SwapExecutor = {
    id: 'oneclick',
    async executableQuote(request) {
      world.quotes.push({ refundTo: request.refundTo, recipient: request.recipient, amountIn: request.amountIn });
      const n = world.quotes.length;
      return {
        amountIn: request.amountIn,
        amountOut: world.amountOut,
        minAmountOut: world.minOut,
        priceImpactBps: null,
        platform: 'NEAR Intents',
        protocols: ['NEAR Intents'],
        raw: {},
        deposit: {
          address: depositAddress(),
          memo: null,
          deadlineMs: clock.now + 10 * 60_000,
          quoteHash: `quote-hash-${n}`,
          correlationId: `corr-${n}`,
        },
      };
    },
    async submitDeposit(input) {
      world.notices.push({ txHash: input.txHash, sender: input.sender });
    },
    async status() {
      if (world.report instanceof Error) throw world.report;
      return world.report;
    },
  };
  const chain: NearChain = {
    async transaction(hash) {
      if (world.down) throw new (await import('@harbor/near/chain')).ChainReadFailed('down');
      return world.transactions.get(hash) ?? null;
    },
    async ftBalance(token, account) {
      if (world.down) throw new (await import('@harbor/near/chain')).ChainReadFailed('down');
      return world.balances.get(`${token}:${account}`) ?? 0n;
    },
  };
  const evm: EvmReader = { receipt: async (_chain, hash) => world.receipts.get(hash) ?? null };
  return { world, executor, chain, evm };
}

export function report(status: SettlementReport['status'], extra: Partial<SettlementReport> = {}): SettlementReport {
  return {
    status,
    amountOut: null,
    refundedAmount: null,
    refundReason: null,
    deliveryTxHashes: [],
    updatedAt: '2026-11-11T12:00:00.000Z',
    ...extra,
  };
}

/** A fresh NEAR implicit account, as each 1Click deposit address is. */
function depositAddress(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The `tx` RPC result for a transaction the wallet signed from Harbor's signing request. */
export function chainResult(
  signer: string,
  signing: {
    receiverId: string;
    actions: { params: { methodName: string; args: unknown; gas: string; deposit: string } }[];
  },
  status: unknown = { SuccessValue: '' },
) {
  return {
    status,
    transaction: {
      signer_id: signer,
      receiver_id: signing.receiverId,
      actions: signing.actions.map((action) => ({
        FunctionCall: {
          method_name: action.params.methodName,
          args: btoa(JSON.stringify(action.params.args)),
          gas: Number(action.params.gas),
          deposit: action.params.deposit,
        },
      })),
    },
    receipts_outcome: [{ outcome: { status: { SuccessValue: '' } } }],
  };
}

/** A fresh, valid-looking NEAR transaction hash. */
export function txHash(): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  return Array.from(crypto.getRandomValues(new Uint8Array(44)), (byte) => alphabet[byte % 58]).join('');
}
