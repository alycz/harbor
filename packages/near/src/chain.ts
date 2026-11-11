/**
 * Reads Harbor checks a deposit and a delivery against, straight from a NEAR RPC: never from the
 * provider that runs the swap. Every read is bounded in time, and a read that fails says nothing
 * about the chain, so callers keep the plan where it was and try again.
 */

const RPC_TIMEOUT_MS = 8_000;
const STORAGE_DEPOSIT_YOCTO = 1_250_000_000_000_000_000_000n;
const WRAP_NEAR = 'wrap.near';
const TX_HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

/** The chain could not be asked; nothing is known about the transaction or balance. */
export class ChainReadFailed extends Error {
  override name = 'ChainReadFailed';
}

export interface NearChain {
  /** The transaction's final result, or null when the chain does not know it (yet). */
  transaction(hash: string, sender: string): Promise<unknown | null>;
  ftBalance(tokenContract: string, account: string): Promise<bigint>;
  /** Whether the account holds a storage registration on the token, so it can receive it. */
  storageRegistered(tokenContract: string, account: string): Promise<boolean>;
  /** The least the token asks to register an account, in yoctoNEAR. */
  storageMinimum(tokenContract: string): Promise<bigint>;
}

export function isTxHash(value: string): boolean {
  return TX_HASH.test(value);
}

export function createNearChain(rpcUrl: string, fetcher: typeof fetch = fetch): NearChain {
  async function rpc(method: string, params: unknown): Promise<{ result?: unknown; error?: unknown }> {
    let response: Response;
    try {
      response = await fetcher(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'harbor', method, params }),
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
        redirect: 'manual',
      });
    } catch (error) {
      throw new ChainReadFailed('The NEAR RPC did not answer.', { cause: error });
    }
    if (!response.ok) throw new ChainReadFailed(`The NEAR RPC answered HTTP ${response.status}.`);
    const body = (await response.json().catch(() => null)) as { result?: unknown; error?: unknown } | null;
    if (!body || typeof body !== 'object')
      throw new ChainReadFailed('The NEAR RPC answered with something unreadable.');
    return body;
  }

  return {
    async transaction(hash, sender) {
      if (!isTxHash(hash)) return null;
      const body = await rpc('tx', { tx_hash: hash, sender_account_id: sender, wait_until: 'EXECUTED_OPTIMISTIC' });
      if (body.error) {
        if (JSON.stringify(body.error).includes('UNKNOWN_TRANSACTION')) return null;
        throw new ChainReadFailed('The NEAR RPC could not read the transaction.');
      }
      return body.result ?? null;
    },
    async ftBalance(tokenContract, account) {
      const value = await view(tokenContract, 'ft_balance_of', { account_id: account });
      if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) {
        throw new ChainReadFailed('The token answered with an unreadable balance.');
      }
      return BigInt(value);
    },
    async storageRegistered(tokenContract, account) {
      const value = await view(tokenContract, 'storage_balance_of', { account_id: account });
      return value !== null && typeof value === 'object';
    },
    async storageMinimum(tokenContract) {
      const value = (await view(tokenContract, 'storage_balance_bounds', {})) as { min?: unknown } | null;
      if (typeof value?.min !== 'string' || !/^[1-9]\d*$/.test(value.min)) {
        throw new ChainReadFailed('The token answered with unreadable storage bounds.');
      }
      return BigInt(value.min);
    },
  };

  async function view(contract: string, method: string, args: Record<string, string>): Promise<unknown> {
    const body = await rpc('query', {
      request_type: 'call_function',
      finality: 'final',
      account_id: contract,
      method_name: method,
      args_base64: btoa(JSON.stringify(args)),
    });
    const bytes = (body.result as { result?: unknown } | undefined)?.result;
    if (body.error || !Array.isArray(bytes)) throw new ChainReadFailed(`The NEAR RPC could not call ${method}.`);
    try {
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(bytes as number[]))) as unknown;
    } catch {
      throw new ChainReadFailed(`${contract} answered ${method} with something unreadable.`);
    }
  }
}

/** The transaction that registers `account` on a token so it can receive it: refundable storage, nothing else. */
export function registrationTransaction(tokenContract: string, account: string, minimumYocto: bigint) {
  return {
    receiverId: tokenContract,
    actions: [
      {
        type: 'FunctionCall' as const,
        params: {
          methodName: 'storage_deposit',
          args: { account_id: account, registration_only: true },
          gas: '30000000000000',
          deposit: minimumYocto.toString(),
        },
      },
    ],
  };
}

/** The one deposit a plan was approved for: who sends, which token, where to, how much. */
export interface PlannedDeposit {
  signer: string;
  tokenContract: string;
  depositAddress: string;
  amountRaw: string;
}

export type DepositCheck =
  | { outcome: 'confirmed' }
  | { outcome: 'pending' }
  | { outcome: 'failed'; detail: string }
  | { outcome: 'mismatch'; detail: string };

interface WalletAction {
  type: 'FunctionCall';
  params: { methodName: string; args: Record<string, string | boolean>; gas: string; deposit: string };
}

/**
 * The transaction the wallet signs for a deposit: register the deposit address on the token (refunded
 * if it already is), wrap NEAR when NEAR is sold, and transfer exactly the planned amount to it.
 */
export function depositTransaction(planned: PlannedDeposit): { receiverId: string; actions: WalletAction[] } {
  const actions: WalletAction[] = [
    {
      type: 'FunctionCall',
      params: {
        methodName: 'storage_deposit',
        args: { account_id: planned.depositAddress, registration_only: true },
        gas: '30000000000000',
        deposit: STORAGE_DEPOSIT_YOCTO.toString(),
      },
    },
  ];
  if (planned.tokenContract === WRAP_NEAR) {
    actions.push({
      type: 'FunctionCall',
      params: { methodName: 'near_deposit', args: {}, gas: '10000000000000', deposit: planned.amountRaw },
    });
  }
  actions.push({
    type: 'FunctionCall',
    params: {
      methodName: 'ft_transfer',
      args: { receiver_id: planned.depositAddress, amount: planned.amountRaw },
      gas: '30000000000000',
      deposit: '1',
    },
  });
  return { receiverId: planned.tokenContract, actions };
}

/**
 * Whether a transaction, as the chain reports it, is exactly the planned deposit: signed by the owner,
 * sent to the token, carrying only the actions Harbor asked for, and transferring exactly the planned
 * amount to the deposit address. Anything else is a mismatch, never a partial match.
 */
export function checkDeposit(result: unknown, planned: PlannedDeposit): DepositCheck {
  const record = asRecord(result);
  const transaction = asRecord(record?.transaction);
  if (!record || !transaction) return { outcome: 'pending' };
  if (transaction.signer_id !== planned.signer) {
    return { outcome: 'mismatch', detail: 'The transaction was signed by another account.' };
  }
  if (transaction.receiver_id !== planned.tokenContract) {
    return { outcome: 'mismatch', detail: 'The transaction was sent to another contract.' };
  }
  const actions = Array.isArray(transaction.actions) ? transaction.actions : [];
  let transfers = 0;
  for (const action of actions) {
    const call = asRecord(asRecord(action)?.FunctionCall);
    if (!call) return { outcome: 'mismatch', detail: 'The transaction carries an action Harbor did not ask for.' };
    const method = call.method_name;
    const args = decodeArgs(call.args);
    const deposit = typeof call.deposit === 'string' ? call.deposit : '';
    if (method === 'storage_deposit' && args?.account_id === planned.depositAddress) continue;
    if (method === 'near_deposit' && planned.tokenContract === WRAP_NEAR && deposit === planned.amountRaw) continue;
    if (
      method === 'ft_transfer' &&
      args?.receiver_id === planned.depositAddress &&
      args.amount === planned.amountRaw &&
      deposit === '1'
    ) {
      transfers += 1;
      continue;
    }
    return { outcome: 'mismatch', detail: `The transaction's ${String(method)} call is not the planned deposit.` };
  }
  if (transfers !== 1)
    return { outcome: 'mismatch', detail: 'The transaction does not make exactly one planned transfer.' };

  const status = asRecord(record.status);
  if (!status) return { outcome: 'pending' };
  if ('Failure' in status)
    return { outcome: 'failed', detail: 'The deposit transaction failed on chain, so nothing moved.' };
  const receipts = Array.isArray(record.receipts_outcome) ? record.receipts_outcome : [];
  const failedReceipt = receipts.some((receipt) => {
    const outcome = asRecord(asRecord(asRecord(receipt)?.outcome)?.status);
    return outcome !== null && 'Failure' in outcome;
  });
  if (failedReceipt) return { outcome: 'failed', detail: 'A step of the deposit failed on chain.' };
  return 'SuccessValue' in status ? { outcome: 'confirmed' } : { outcome: 'pending' };
}

/** The NEP-141 contract behind a 1Click asset ID such as `nep141:wrap.near`, or null. */
export function tokenContractOf(assetId: string): string | null {
  const match = /^nep141:([a-z\d][a-z\d._-]*)$/.exec(assetId);
  return match?.[1] ?? null;
}

function decodeArgs(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null;
  try {
    const text = new TextDecoder().decode(Uint8Array.from(atob(value), (character) => character.charCodeAt(0)));
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
