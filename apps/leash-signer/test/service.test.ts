import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('near-api-js', () => ({
  actions: { functionCall: vi.fn(() => ({})) },
  baseDecode: () => new Uint8Array(32),
  baseEncode: () => 'A'.repeat(44),
  createTransaction: vi.fn(() => ({})),
  KeyPairSigner: {
    fromSecretKey: () => ({
      getPublicKey: async () => ({ toString: () => 'public-fixture' }),
      signTransaction: async () => ({
        txHash: new Uint8Array(32),
        signedTransaction: { encode: () => new Uint8Array([1]) },
      }),
    }),
  },
}));

import { LeashSigner } from '../src/index.ts';

let records: Map<string, unknown>;
let service: LeashSigner;
let broadcasts: number;
let failBroadcast: boolean;
let permission: unknown;
const payload = {
  network: 'mainnet',
  signerId: 'agent.near',
  receiverId: 'vault.near',
  methodName: 'execute',
  gas: '100000000000000',
  deposit: '0',
  args: {
    owner: 'owner.near',
    quote: JSON.stringify({ dry: false, refundTo: 'owner.near', deadline: '2099-01-01T00:00:00Z' }),
    signature: 'fixture',
  },
};
function submit(id = 'execution_1', data = payload) {
  return service.fetch(
    new Request('https://internal/v1/submit', {
      method: 'POST',
      headers: { 'idempotency-key': id },
      body: JSON.stringify(data),
    }),
  );
}
beforeEach(() => {
  records = new Map();
  broadcasts = 0;
  failBroadcast = false;
  permission = { FunctionCall: { receiver_id: 'vault.near', method_names: ['execute'], allowance: '100' } };
  const ctx = {
    blockConcurrencyWhile: async (callback: () => Promise<unknown>) => callback(),
    storage: {
      get: async (key: string) => records.get(key),
      put: async (key: string | Record<string, unknown>, value: unknown) => {
        if (typeof key === 'string') records.set(key, value);
        else for (const [k, v] of Object.entries(key)) records.set(k, v);
      },
    },
  };
  service = new LeashSigner(ctx as unknown as DurableObjectState, {
    SIGNER: {} as DurableObjectNamespace,
    LEASH_AGENT_ACCOUNT_ID: 'agent.near',
    LEASH_CONTRACT_ID: 'vault.near',
    LEASH_AGENT_PRIVATE_KEY: 'MOCK_ONLY_NOT_A_KEY',
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init: RequestInit) => {
      const { method } = JSON.parse(init.body as string);
      if (method === 'query') return Response.json({ result: { permission, nonce: 1, block_hash: 'fixture' } });
      broadcasts++;
      expect((records.get('execution:execution_1') as { txHash: string }).txHash).toBe('A'.repeat(44));
      if (failBroadcast) throw new Error('timeout');
      return Response.json({ result: 'A'.repeat(44) });
    }),
  );
});
it('persists hash before broadcasting and never resubmits same id', async () => {
  expect((await submit()).status).toBe(200);
  expect((await submit()).status).toBe(200);
  expect(broadcasts).toBe(1);
});
it('recovers ambiguous broadcast without replay', async () => {
  failBroadcast = true;
  expect((await submit()).status).toBe(503);
  expect((await service.fetch(new Request('https://internal/v1/executions/execution_1'))).status).toBe(200);
  expect((await submit()).status).toBe(200);
  expect(broadcasts).toBe(1);
});
it('rejects same id with changed payload', async () => {
  await submit();
  expect((await submit('execution_1', { ...payload, args: { ...payload.args, signature: 'changed' } })).status).toBe(
    409,
  );
  expect(broadcasts).toBe(1);
});
it('refuses full access before signing or claim', async () => {
  permission = 'FullAccess';
  expect((await submit()).status).toBe(503);
  expect(broadcasts).toBe(0);
  expect(records.size).toBe(0);
});
it('never retries a preexisting unknown claim', async () => {
  await submit();
  const record = records.get('execution:execution_1') as { digest: string };
  records.set('execution:execution_1', { digest: record.digest, state: 'claimed' });
  expect((await submit()).status).toBe(409);
  expect(broadcasts).toBe(1);
});
