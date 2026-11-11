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
  /** A transaction receipt, or null while the chain does not know it. */
  receipt(chain: string, hash: string): Promise<unknown | null>;
}

export function createEvmReader(fetcher: typeof fetch = fetch): EvmReader {
  return {
    async receipt(chain, hash) {
      const url = EVM_RPC[chain];
      if (!url || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return null;
      let response: Response;
      try {
        response = await fetcher(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [hash] }),
          signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
          redirect: 'manual',
        });
      } catch (error) {
        throw new ChainReadFailed(`The ${chain} RPC did not answer.`, { cause: error });
      }
      if (!response.ok) throw new ChainReadFailed(`The ${chain} RPC answered HTTP ${response.status}.`);
      const body = (await response.json().catch(() => null)) as { result?: unknown } | null;
      return body?.result ?? null;
    },
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
