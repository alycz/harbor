import { DurableObject } from 'cloudflare:workers';
import { actions, baseDecode, baseEncode, createTransaction, KeyPairSigner, type KeyPairString } from 'near-api-js';
import { checkKey, checkScope } from './scope.ts';

interface Env {
  SIGNER: DurableObjectNamespace;
  LEASH_AGENT_ACCOUNT_ID: string;
  LEASH_CONTRACT_ID: string;
  LEASH_AGENT_PRIVATE_KEY: string;
}
interface RecordValue {
  digest: string;
  txHash?: string;
  state: 'claimed' | 'broadcast-attempted';
}
/** Private service binding only: never add a public route or workers.dev URL. */
export default {
  async fetch(request: Request, env: Env) {
    if (!env.LEASH_AGENT_ACCOUNT_ID || !env.LEASH_CONTRACT_ID || !env.LEASH_AGENT_PRIVATE_KEY)
      return new Response('Signer not configured', { status: 503 });
    return env.SIGNER.get(env.SIGNER.idFromName(env.LEASH_AGENT_ACCOUNT_ID)).fetch(request);
  },
};
export class LeashSigner extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    // Serialize the complete request, including external awaits: one nonce stream per agent.
    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        return await this.handle(request);
      } catch {
        return new Response('Signer unavailable; recover existing execution, never retry automatically', {
          status: 503,
        });
      }
    });
  }
  private async rpc(method: string, params: unknown): Promise<unknown> {
    const response = await fetch('https://rpc.mainnet.near.org', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'leash', method, params }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('RPC unavailable');
    const body = (await response.json()) as { error?: unknown; result?: unknown };
    if (body.error || !body.result) throw new Error('RPC rejected');
    return body.result;
  }
  private result(record: RecordValue) {
    return record.txHash
      ? Response.json({
          txHash: record.txHash,
          signerId: this.env.LEASH_AGENT_ACCOUNT_ID,
          contractId: this.env.LEASH_CONTRACT_ID,
          state: record.state,
        })
      : new Response('Outcome unknown; no resubmission', { status: 409 });
  }
  private async handle(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const recovery = /^\/v1\/executions\/([A-Za-z0-9_-]{8,128})$/.exec(path);
    if (request.method === 'GET' && recovery) {
      const record = await this.ctx.storage.get<RecordValue>(`execution:${recovery[1]}`);
      return record ? this.result(record) : new Response('Not found', { status: 404 });
    }
    if (request.method !== 'POST' || path !== '/v1/submit') return new Response('Not found', { status: 404 });
    const id = request.headers.get('idempotency-key') ?? '';
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) return new Response('Invalid execution ID', { status: 400 });
    const text = await request.text();
    if (text.length > 40000) return new Response('Too large', { status: 413 });
    const input = checkScope(JSON.parse(text), this.env.LEASH_AGENT_ACCOUNT_ID, this.env.LEASH_CONTRACT_ID);
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input)))),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('');
    const key = `execution:${id}`;
    const previous = await this.ctx.storage.get<RecordValue>(key);
    if (previous)
      return previous.digest === digest
        ? this.result(previous)
        : new Response('Execution ID conflict', { status: 409 });
    const signer = KeyPairSigner.fromSecretKey(this.env.LEASH_AGENT_PRIVATE_KEY as KeyPairString);
    const publicKey = await signer.getPublicKey();
    const access = (await this.rpc('query', {
      request_type: 'view_access_key',
      account_id: input.signerId,
      public_key: publicKey.toString(),
      finality: 'final',
    })) as { permission: unknown; nonce: number; block_hash: string };
    checkKey(access.permission, input.receiverId);
    if (!Number.isSafeInteger(access.nonce) || access.nonce < 0) throw new Error('Invalid nonce');
    const savedNonce = await this.ctx.storage.get<string>('nonce');
    const chainNonce = BigInt(access.nonce);
    const nonce = (savedNonce && BigInt(savedNonce) > chainNonce ? BigInt(savedNonce) : chainNonce) + 1n;
    await this.ctx.storage.put({ [key]: { digest, state: 'claimed' }, nonce: nonce.toString() });
    const tx = createTransaction(
      input.signerId,
      publicKey,
      input.receiverId,
      nonce,
      [actions.functionCall('execute', input.args, 100000000000000n, 0n)],
      baseDecode(access.block_hash),
    );
    const signed = await signer.signTransaction(tx);
    const txHash = baseEncode(signed.txHash);
    const record: RecordValue = { digest, txHash, state: 'broadcast-attempted' };
    // Persist hash BEFORE network: a crash/timeout can never cause a second transaction.
    await this.ctx.storage.put(key, record);
    await this.rpc('broadcast_tx_async', [btoa(String.fromCharCode(...signed.signedTransaction.encode()))]);
    return this.result(record);
  }
}
