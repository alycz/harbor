import { ChainReadFailed, type NearChain, tokenContractOf } from '@harbor/near/chain';

const RPC_TIMEOUT_MS = 8_000;
/** keccak256("Transfer(address,address,uint256)"): the ERC-20 transfer event. */
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
/** Public RPCs Harbor reads EVM deliveries from: never the provider that ran the swap. */
const EVM_RPC: Readonly<Record<string, string>> = {
  eth: 'https://ethereum-rpc.publicnode.com',
  base: 'https://mainnet.base.org',
  arb: 'https://arb1.arbitrum.io/rpc',
};
const BRIDGED_TOKEN = /^nep141:(eth|base|arb)-(0x[0-9a-f]{40})\.omft\.near$/;

export interface EvmReader {
  /** A transaction and receipt, or null while the chain does not know them. */
  transaction?(chain: string, hash: string): Promise<unknown | null>;
  receipt(chain: string, hash: string): Promise<unknown | null>;
}

export function createEvmReader(fetcher: typeof fetch = fetch): EvmReader {
  async function rpc(chain: string, hash: string, method: string): Promise<unknown | null> {
    const url = EVM_RPC[chain];
    if (!url || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return null;
    let response: Response;
    try {
      response = await fetcher(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [hash] }),
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
        redirect: 'manual',
      });
    } catch (error) {
      throw new ChainReadFailed(`The ${chain} RPC did not answer.`, { cause: error });
    }
    if (!response.ok) throw new ChainReadFailed(`The ${chain} RPC answered HTTP ${response.status}.`);
    const body = (await response.json().catch(() => null)) as { result?: unknown } | null;
    return body?.result ?? null;
  }
  return {
    transaction: (chain, hash) => rpc(chain, hash, 'eth_getTransactionByHash'),
    receipt: (chain, hash) => rpc(chain, hash, 'eth_getTransactionReceipt'),
  };
}

/** Where a delivery can be checked, and against what. */
export interface Delivery {
  chain: string;
  recipient: string;
  buyAsset: string;
  minOutRaw: bigint;
  /** The recipient's balance of the bought token when the owner approved, for NEAR deliveries. */
  balanceBeforeRaw: bigint | null;
  deliveryTxHashes: readonly string[];
}

export type OriginDepositCheck =
  | { outcome: 'confirmed' }
  | { outcome: 'pending' }
  | { outcome: 'failed'; detail: string }
  | { outcome: 'mismatch'; detail: string };

/** Independently decodes an EVM origin deposit; provider status is never used as proof. */
export async function verifyEvmDeposit(
  evm: EvmReader,
  input: {
    chain: string;
    txHash: string;
    asset: string;
    sender: string;
    depositAddress: string;
    amountRaw: bigint;
  },
): Promise<OriginDepositCheck> {
  if (!['eth', 'base', 'arb'].includes(input.chain)) {
    return { outcome: 'mismatch', detail: 'The origin chain is not supported for verified deposits.' };
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.sender) || !/^0x[0-9a-fA-F]{40}$/.test(input.depositAddress)) {
    return { outcome: 'mismatch', detail: 'The origin or deposit address is invalid.' };
  }
  if (!evm.transaction) return { outcome: 'mismatch', detail: 'No origin-chain transaction reader is configured.' };
  const transaction = (await evm.transaction(input.chain, input.txHash)) as {
    hash?: unknown;
    from?: unknown;
    to?: unknown;
    input?: unknown;
    value?: unknown;
  } | null;
  const receipt = (await evm.receipt(input.chain, input.txHash)) as {
    transactionHash?: unknown;
    status?: unknown;
    logs?: unknown;
  } | null;
  if (!transaction || !receipt) return { outcome: 'pending' };
  if (
    String(transaction.hash).toLowerCase() !== input.txHash.toLowerCase() ||
    String(receipt.transactionHash).toLowerCase() !== input.txHash.toLowerCase()
  ) {
    return { outcome: 'mismatch', detail: 'The RPC response does not match the submitted transaction hash.' };
  }
  if (receipt.status !== '0x1') return { outcome: 'failed', detail: 'The origin-chain transaction failed.' };
  if (String(transaction.from).toLowerCase() !== input.sender.toLowerCase()) {
    return { outcome: 'mismatch', detail: 'The transaction sender is not the policy-bound origin address.' };
  }
  if (input.asset === 'nep141:eth.omft.near') {
    if (
      input.chain !== 'eth' ||
      String(transaction.to).toLowerCase() !== input.depositAddress.toLowerCase() ||
      typeof transaction.value !== 'string' ||
      !/^0x[0-9a-fA-F]+$/.test(transaction.value) ||
      BigInt(transaction.value) !== input.amountRaw ||
      !['0x', '0x0', ''].includes(String(transaction.input).toLowerCase())
    ) {
      return { outcome: 'mismatch', detail: 'The native transfer does not match the planned deposit.' };
    }
    return { outcome: 'confirmed' };
  }
  const token = BRIDGED_TOKEN.exec(input.asset);
  if (
    !token ||
    token[1] !== input.chain ||
    String(transaction.to).toLowerCase() !== token[2]?.toLowerCase() ||
    typeof transaction.value !== 'string' ||
    !/^0x[0-9a-fA-F]+$/.test(transaction.value) ||
    BigInt(transaction.value) !== 0n
  ) {
    return { outcome: 'mismatch', detail: 'The token contract does not match the planned origin asset.' };
  }
  const recipientWord = input.depositAddress.toLowerCase().slice(2).padStart(64, '0');
  const amountWord = input.amountRaw.toString(16).padStart(64, '0');
  const expected = `0xa9059cbb${recipientWord}${amountWord}`;
  if (String(transaction.input).toLowerCase() !== expected) {
    return { outcome: 'mismatch', detail: 'The token transfer receiver or amount does not match the plan.' };
  }
  const senderTopic = `0x${input.sender.toLowerCase().slice(2).padStart(64, '0')}`;
  const recipientTopic = `0x${recipientWord}`;
  const amountData = `0x${amountWord}`;
  const transferred = Array.isArray(receipt.logs)
    ? (receipt.logs as Array<{ address?: unknown; topics?: unknown; data?: unknown }>).some((log) => {
        const topics = Array.isArray(log.topics)
          ? (log.topics as unknown[]).map((topic) => String(topic).toLowerCase())
          : [];
        return (
          String(log.address).toLowerCase() === token[2]?.toLowerCase() &&
          topics[0] === TRANSFER_TOPIC &&
          topics[1] === senderTopic &&
          topics[2] === recipientTopic &&
          String(log.data).toLowerCase() === amountData
        );
      })
    : false;
  if (!transferred) {
    return { outcome: 'mismatch', detail: 'No exact token Transfer event proves the planned deposit succeeded.' };
  }
  return { outcome: 'confirmed' };
}

const WRAPPED_NEAR = 'nep141:wrap.near';
const INTENTS_CONTRACT = 'intents.near';

/**
 * Native NEAR the intents contract paid to `recipient` in one NEAR transaction, from the `native_withdraw`
 * events that contract logged in receipts that succeeded. Logs from any other contract are ignored, so
 * nothing else can fake one.
 */
function nativeWithdrawn(result: unknown, recipient: string): bigint {
  const record = result as { status?: unknown; receipts_outcome?: unknown } | null;
  const status = record?.status;
  if (!status || typeof status !== 'object' || !('SuccessValue' in status)) return 0n;
  if (!Array.isArray(record?.receipts_outcome)) return 0n;
  let total = 0n;
  for (const entry of record.receipts_outcome as { outcome?: Record<string, unknown> }[]) {
    const outcome = entry.outcome;
    if (!outcome || outcome.executor_id !== INTENTS_CONTRACT || !Array.isArray(outcome.logs)) continue;
    const receiptStatus = outcome.status;
    if (!receiptStatus || typeof receiptStatus !== 'object' || 'Failure' in receiptStatus) continue;
    for (const log of outcome.logs) {
      if (typeof log !== 'string' || !log.startsWith('EVENT_JSON:')) continue;
      let event: { standard?: unknown; event?: unknown; data?: unknown };
      try {
        event = JSON.parse(log.slice('EVENT_JSON:'.length)) as typeof event;
      } catch {
        continue;
      }
      if (event.standard !== 'dip4' || event.event !== 'native_withdraw' || !Array.isArray(event.data)) continue;
      for (const item of event.data as { receiver_id?: unknown; amount?: unknown }[]) {
        if (item.receiver_id === recipient && typeof item.amount === 'string' && /^[1-9]\d*$/.test(item.amount)) {
          total += BigInt(item.amount);
        }
      }
    }
  }
  return total;
}

async function verifyNativeNearDelivery(chain: NearChain, delivery: Delivery): Promise<DeliveryCheck> {
  let received = 0n;
  let proof: string | null = null;
  for (const hash of delivery.deliveryTxHashes) {
    // The RPC finds a transaction by hash whatever sender is named; the recipient is as good as any.
    const paid = nativeWithdrawn(await chain.transaction(hash, delivery.recipient), delivery.recipient);
    if (paid > 0n) {
      received += paid;
      proof = hash;
    }
  }
  return received >= delivery.minOutRaw && delivery.minOutRaw > 0n && proof
    ? { verified: true, txHash: proof, receivedRaw: received }
    : { verified: false, reason: 'No delivery transaction shows the minimum NEAR reaching the recipient yet.' };
}

export type DeliveryCheck =
  | { verified: true; txHash: string | null; receivedRaw: bigint }
  | { verified: false; reason: string };

/**
 * Checks on the destination chain itself that at least the minimum arrived at the owner's address.
 * NEAR: the recipient's token balance rose by at least the minimum since approval. EVM: a successful
 * receipt carries a transfer of the token to the recipient of at least the minimum. Anything Harbor
 * cannot check this way stays unverified; the provider's word is never enough.
 */
export async function verifyDelivery(chain: NearChain, evm: EvmReader, delivery: Delivery): Promise<DeliveryCheck> {
  if (delivery.chain === 'near') {
    if (delivery.buyAsset === WRAPPED_NEAR) {
      // A swap into NEAR is paid out as native NEAR, so the wNEAR balance never moves. The delivery
      // transaction's own events are the proof; a wNEAR payout falls through to the balance check below.
      const native = await verifyNativeNearDelivery(chain, delivery);
      if (native.verified) return native;
    }
    const token = tokenContractOf(delivery.buyAsset);
    if (!token) return { verified: false, reason: 'The bought asset is not a NEP-141 token Harbor can read.' };
    if (delivery.balanceBeforeRaw === null) {
      return { verified: false, reason: 'No starting balance was recorded, so the delivery cannot be measured.' };
    }
    const now = await chain.ftBalance(token, delivery.recipient);
    const received = now - delivery.balanceBeforeRaw;
    return received >= delivery.minOutRaw
      ? { verified: true, txHash: delivery.deliveryTxHashes.at(-1) ?? null, receivedRaw: received }
      : { verified: false, reason: 'The recipient has not received the minimum yet.' };
  }
  const bridged = BRIDGED_TOKEN.exec(delivery.buyAsset);
  if (!bridged || bridged[1] !== delivery.chain || !bridged[2]) {
    return { verified: false, reason: `Harbor cannot check deliveries of this asset on ${delivery.chain} yet.` };
  }
  const token = bridged[2];
  for (const hash of delivery.deliveryTxHashes) {
    const received = transferredTo(await evm.receipt(delivery.chain, hash), token, delivery.recipient);
    if (received >= delivery.minOutRaw) return { verified: true, txHash: hash, receivedRaw: received };
  }
  return { verified: false, reason: 'No delivery receipt shows the minimum reaching the recipient yet.' };
}

/** The total of `token` a successful receipt transferred to `recipient`; zero for anything else. */
function transferredTo(receipt: unknown, token: string, recipient: string): bigint {
  const record = receipt as { status?: unknown; logs?: unknown } | null;
  if (record?.status !== '0x1' || !Array.isArray(record.logs)) return 0n;
  const to = `0x${recipient.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
  let total = 0n;
  for (const log of record.logs as { address?: unknown; topics?: unknown; data?: unknown }[]) {
    const topics = Array.isArray(log.topics)
      ? (log.topics as unknown[]).map((topic) => String(topic).toLowerCase())
      : [];
    if (
      String(log.address).toLowerCase() === token.toLowerCase() &&
      topics[0] === TRANSFER_TOPIC &&
      topics[2] === to &&
      typeof log.data === 'string' &&
      /^0x[0-9a-fA-F]{1,64}$/.test(log.data)
    ) {
      total += BigInt(log.data);
    }
  }
  return total;
}
