import { z } from 'zod';

/**
 * Rhea Lend (formerly Burrow) on NEAR mainnet. Reads a market and an account straight from the
 * contract, builds the wallet calls a supply needs, and checks a finished supply against the chain.
 * It never signs or submits anything.
 *
 * Every view and call shape here was checked against contract.main.burrow.near on 2026-11-15,
 * including a real supply (CX3nCVEtyTH7k3fhn3NruvYJmb6XXVDMyw4YMHU1dKNh) kept as a test fixture.
 */
export const RHEA_LENDING_CONTRACT = 'contract.main.burrow.near';
/** Rhea's own app sends 100 Tgas; the fixture supply burnt about 15 Tgas end to end. */
const SUPPLY_GAS = '100000000000000';
const REGISTRATION_GAS = '30000000000000';
const READ_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 262_144;

const ACCOUNT = /^(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const U128 = z.string().regex(/^(0|[1-9]\d{0,38})$/);
const U128_MAX = (1n << 128n) - 1n;

/** The chain could not be asked; nothing is known about the market or the account. */
export class RheaReadFailed extends Error {
  override name = 'RheaReadFailed';
}

/** One call for the wallet to sign and send, in NEAR Connect's action shape. */
export interface RheaCall {
  receiverId: string;
  actions: [
    {
      type: 'FunctionCall';
      params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string };
    },
  ];
}

export interface RheaMarket {
  tokenId: string;
  canDeposit: boolean;
  canWithdraw: boolean;
  /** Rhea keeps balances with this many decimals more than the token's own. */
  extraDecimals: number;
  /** The current supply APR from the contract, as a percentage; null when the contract has none. */
  supplyAprPct: number | null;
  /** Everything supplied to the market, in token units. */
  totalSuppliedRaw: bigint;
  /** How much more the market accepts before its supply cap, in token units; null when uncapped. */
  remainingCapRaw: bigint | null;
}

export interface RheaReader {
  market(tokenId: string): Promise<RheaMarket>;
  /** Whether the account holds Rhea's storage registration, which a supply needs. */
  registered(accountId: string): Promise<boolean>;
  /** The yoctoNEAR Rhea asks to register an account. */
  registrationDeposit(): Promise<bigint>;
  tokenBalance(tokenId: string, accountId: string): Promise<bigint>;
  /** What the account has supplied of this token, in token units. */
  supplied(accountId: string, tokenId: string, extraDecimals: number): Promise<bigint>;
  /** The transaction's final result, or null when the chain does not know it (yet). */
  transaction(hash: string, sender: string): Promise<unknown | null>;
  blockTimestampMs(blockHash: string): Promise<number>;
}

const AssetView = z.object({
  token_id: z.string(),
  supplied: z.object({ balance: U128 }),
  supply_apr: z.string().optional(),
  config: z.object({
    can_deposit: z.boolean(),
    can_withdraw: z.boolean(),
    extra_decimals: z.number().int().min(0).max(30),
    supplied_limit: U128.nullish(),
  }),
});
const AccountView = z.object({ supplied: z.array(z.object({ token_id: z.string(), balance: U128 })) }).nullable();
const StorageView = z.object({ total: U128, available: U128 }).nullable();

export function createRheaReader(rpcUrl: string, fetcher: typeof fetch = fetch): RheaReader {
  async function rpc(method: string, params: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'harbor-rhea', method, params }),
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        redirect: 'manual',
      });
    } catch (error) {
      throw new RheaReadFailed('The NEAR RPC did not answer.', { cause: error });
    }
    if (!response.ok) throw new RheaReadFailed(`The NEAR RPC answered HTTP ${response.status}.`);
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES * 4) throw new RheaReadFailed('The NEAR RPC answer was too large.');
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new RheaReadFailed('The NEAR RPC answered with something unreadable.');
    }
  }

  async function view(accountId: string, methodName: string, args: Record<string, unknown>): Promise<unknown> {
    if (!ACCOUNT.test(accountId)) throw new RheaReadFailed('Not a NEAR account ID.');
    const body = z
      .object({ result: z.object({ result: z.array(z.number().int().min(0).max(255)).max(MAX_RESPONSE_BYTES) }) })
      .safeParse(
        await rpc('query', {
          request_type: 'call_function',
          finality: 'final',
          account_id: accountId,
          method_name: methodName,
          args_base64: btoa(JSON.stringify(args)),
        }),
      );
    if (!body.success) throw new RheaReadFailed(`The contract did not answer ${methodName}.`);
    return JSON.parse(new TextDecoder().decode(new Uint8Array(body.data.result.result))) as unknown;
  }

  return {
    async market(tokenId) {
      const parsed = AssetView.safeParse(await view(RHEA_LENDING_CONTRACT, 'get_asset', { token_id: tokenId }));
      if (!parsed.success || parsed.data.token_id !== tokenId) {
        throw new RheaReadFailed('Rhea does not list this token.');
      }
      const { config, supplied, supply_apr } = parsed.data;
      const scale = 10n ** BigInt(config.extra_decimals);
      const room = config.supplied_limit == null ? null : BigInt(config.supplied_limit) - BigInt(supplied.balance);
      const apr = supply_apr === undefined ? Number.NaN : Number(supply_apr) * 100;
      return {
        tokenId,
        canDeposit: config.can_deposit,
        canWithdraw: config.can_withdraw,
        extraDecimals: config.extra_decimals,
        supplyAprPct: Number.isFinite(apr) && apr >= 0 ? apr : null,
        totalSuppliedRaw: BigInt(supplied.balance) / scale,
        remainingCapRaw: room === null ? null : room > 0n ? room / scale : 0n,
      };
    },
    async registered(accountId) {
      const storage = StorageView.safeParse(
        await view(RHEA_LENDING_CONTRACT, 'storage_balance_of', { account_id: accountId }),
      );
      if (!storage.success) throw new RheaReadFailed('Rhea answered storage_balance_of unexpectedly.');
      return storage.data !== null && BigInt(storage.data.total) > 0n;
    },
    async registrationDeposit() {
      const bounds = z.object({ min: U128 }).safeParse(await view(RHEA_LENDING_CONTRACT, 'storage_balance_bounds', {}));
      if (!bounds.success) throw new RheaReadFailed('Rhea answered storage_balance_bounds unexpectedly.');
      return BigInt(bounds.data.min);
    },
    async tokenBalance(tokenId, accountId) {
      const balance = U128.safeParse(await view(tokenId, 'ft_balance_of', { account_id: accountId }));
      if (!balance.success) throw new RheaReadFailed('The token answered ft_balance_of unexpectedly.');
      return BigInt(balance.data);
    },
    async supplied(accountId, tokenId, extraDecimals) {
      const account = AccountView.safeParse(
        await view(RHEA_LENDING_CONTRACT, 'get_account', { account_id: accountId }),
      );
      if (!account.success) throw new RheaReadFailed('Rhea answered get_account unexpectedly.');
      const entry = account.data?.supplied.find((item) => item.token_id === tokenId);
      return entry ? BigInt(entry.balance) / 10n ** BigInt(extraDecimals) : 0n;
    },
    async transaction(hash, sender) {
      const body = (await rpc('tx', { tx_hash: hash, sender_account_id: sender, wait_until: 'FINAL' })) as {
        result?: unknown;
        error?: unknown;
      };
      if (body.error) {
        if (JSON.stringify(body.error).includes('UNKNOWN_TRANSACTION')) return null;
        throw new RheaReadFailed('The NEAR RPC could not read the transaction.');
      }
      return body.result ?? null;
    },
    async blockTimestampMs(blockHash) {
      const block = z
        .object({ result: z.object({ header: z.object({ timestamp_nanosec: z.string().regex(/^\d+$/) }) }) })
        .safeParse(await rpc('block', { block_id: blockHash }));
      if (!block.success) throw new RheaReadFailed('The NEAR RPC could not read the block.');
      return Number(BigInt(block.data.result.header.timestamp_nanosec) / 1_000_000n);
    },
  };
}

/** Rhea's one-time storage registration; it refunds anything above the minimum. */
export function registrationCall(accountId: string, depositYocto: bigint): RheaCall {
  return {
    receiverId: RHEA_LENDING_CONTRACT,
    actions: [
      {
        type: 'FunctionCall',
        params: {
          methodName: 'storage_deposit',
          args: { account_id: accountId, registration_only: true },
          gas: REGISTRATION_GAS,
          deposit: depositYocto.toString(),
        },
      },
    ],
  };
}

/**
 * Supplies the token to Rhea. The empty `msg` is a plain supply: it earns the supply rate and is
 * never posted as collateral, so it can never be liquidated.
 */
export function supplyCall(tokenId: string, amountRaw: bigint): RheaCall {
  if (amountRaw <= 0n || amountRaw > U128_MAX) throw new RangeError('Supply amount out of range.');
  return {
    receiverId: tokenId,
    actions: [
      {
        type: 'FunctionCall',
        params: {
          methodName: 'ft_transfer_call',
          args: { receiver_id: RHEA_LENDING_CONTRACT, amount: amountRaw.toString(), msg: '' },
          gas: SUPPLY_GAS,
          deposit: '1',
        },
      },
    ],
  };
}

/**
 * What a finished transaction proves about one planned supply:
 * - confirmed: the exact approved transfer, every receipt succeeded, the token reports the whole
 *   amount used, and Rhea logged a deposit of it for this account (and nothing posted as collateral)
 * - refunded: the transfer ran but Rhea handed the tokens back
 * - failed: a receipt failed
 * - mismatch: this is not the approved transaction
 * - pending: not final yet, or not readable
 */
export type SupplyOutcome = 'confirmed' | 'refunded' | 'failed' | 'mismatch' | 'pending';

const Status = z.record(z.string(), z.unknown());
const TxResult = z.object({
  final_execution_status: z.string(),
  status: Status,
  transaction: z.object({
    hash: z.string(),
    signer_id: z.string(),
    receiver_id: z.string(),
    actions: z.array(z.unknown()),
  }),
  transaction_outcome: z.object({ block_hash: z.string() }),
  receipts_outcome: z.array(
    z.object({ outcome: z.object({ executor_id: z.string(), status: Status, logs: z.array(z.string()) }) }),
  ),
});
const TransferCall = z.object({
  FunctionCall: z.object({ method_name: z.literal('ft_transfer_call'), args: z.string(), deposit: z.literal('1') }),
});
const TransferArgs = z.strictObject({ receiver_id: z.string(), amount: z.string(), msg: z.string() });
const BurrowEvent = z.object({
  standard: z.literal('burrow'),
  event: z.string(),
  data: z.array(
    z.object({ account_id: z.string().optional(), token_id: z.string().optional(), amount: z.string().optional() }),
  ),
});

export function checkSupplyReceipt(
  value: unknown,
  expected: { txHash: string; accountId: string; tokenId: string; amountRaw: bigint; extraDecimals: number },
): SupplyOutcome {
  const parsed = TxResult.safeParse(value);
  if (!parsed.success) return 'pending';
  const { transaction, status, receipts_outcome, final_execution_status } = parsed.data;

  const call = transaction.actions.length === 1 ? TransferCall.safeParse(transaction.actions[0]) : null;
  const args = call?.success ? TransferArgs.safeParse(decodeJson(call.data.FunctionCall.args)) : null;
  if (
    transaction.hash !== expected.txHash ||
    transaction.signer_id !== expected.accountId ||
    transaction.receiver_id !== expected.tokenId ||
    !args?.success ||
    args.data.receiver_id !== RHEA_LENDING_CONTRACT ||
    args.data.amount !== expected.amountRaw.toString() ||
    args.data.msg !== ''
  ) {
    return 'mismatch';
  }

  if ('Failure' in status || receipts_outcome.some((receipt) => 'Failure' in receipt.outcome.status)) return 'failed';
  if (final_execution_status !== 'FINAL' || typeof status.SuccessValue !== 'string') return 'pending';

  // ft_transfer_call resolves to the amount the receiver kept; anything short was handed back.
  const used = decodeJson(status.SuccessValue);
  if (used !== expected.amountRaw.toString()) return 'refunded';

  const events = receipts_outcome
    .filter((receipt) => receipt.outcome.executor_id === RHEA_LENDING_CONTRACT)
    .flatMap((receipt) => receipt.outcome.logs)
    .filter((log) => log.startsWith('EVENT_JSON:'))
    .map((log) => BurrowEvent.safeParse(decodeJsonText(log.slice('EVENT_JSON:'.length))))
    .flatMap((event) => (event.success ? [event.data] : []));
  const innerAmount = (expected.amountRaw * 10n ** BigInt(expected.extraDecimals)).toString();
  const deposited = events.some(
    (event) =>
      event.event === 'deposit' &&
      event.data.some(
        (item) =>
          item.account_id === expected.accountId && item.token_id === expected.tokenId && item.amount === innerAmount,
      ),
  );
  const collateralised = events.some((event) => event.event === 'increase_collateral');
  return deposited && !collateralised ? 'confirmed' : 'mismatch';
}

function decodeJson(base64: string): unknown {
  try {
    return decodeJsonText(new TextDecoder().decode(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))));
  } catch {
    return undefined;
  }
}

function decodeJsonText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
