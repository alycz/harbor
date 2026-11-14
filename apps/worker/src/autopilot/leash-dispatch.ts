import { verifyOneClickQuoteSignature } from '@harbor/adapters/oneclick/signature';
import { AppError } from '@harbor/domain/errors';
import { isTxHash, tokenContractOf } from '@harbor/near/chain';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app.ts';
import { decodeExecutionConfig } from '../config.ts';
import { executionDeps } from '../execution/store.ts';
import { type LeashRequest, submitLeash } from '../leash/execution.ts';
import { leashJournal } from '../leash/journal.ts';
import { leashSnapshot, validateLeashQuote } from '../leash/routes.ts';
import { reconcileLeashDelivery } from '../leash/settlement.ts';
import { createLeashServiceSigner } from '../leash/signer-service.ts';

type Bindings = { LEASH_SIGNER?: Fetcher; LEASH_EXECUTION_ENABLED?: string; LEASH_CONTRACT_CODE_HASH?: string };
export function leashAvailable(env: unknown) {
  const config = decodeExecutionConfig(env);
  const b = env as Bindings;
  return (
    config.network === 'mainnet' &&
    config.executionEnabled &&
    config.writeAdapters.has('oneclick') &&
    b.LEASH_EXECUTION_ENABLED === 'true' &&
    !!b.LEASH_SIGNER &&
    !!b.LEASH_CONTRACT_CODE_HASH
  );
}
async function assertCode(env: Env, rpc: string, contract: string) {
  const expected = (env as Bindings).LEASH_CONTRACT_CODE_HASH;
  if (!expected || !isTxHash(expected))
    throw new AppError('SETUP_REQUIRED', 'Pin the reviewed deployed Leash code hash.');
  const response = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'leash-code',
      method: 'query',
      params: { request_type: 'view_account', finality: 'final', account_id: contract },
    }),
  });
  const body = z.object({ result: z.object({ code_hash: z.string() }) }).safeParse(await response.json());
  if (!response.ok || !body.success || body.data.result.code_hash !== expected)
    throw new AppError('FORBIDDEN', 'Leash contract code is not the reviewed deployment.');
}
interface Approval {
  id: string;
  owner: string;
  request_json: string;
  quote_response: string;
  balance_before: string | null;
}
async function approved(db: D1Database, id: string, owner: string) {
  const row = await db
    .prepare('SELECT * FROM leash_approvals WHERE id=? AND owner=?')
    .bind(id, owner)
    .first<Approval>();
  if (!row) throw new AppError('NOT_FOUND', 'No approved Leash execution.');
  return row;
}
/** Mounted behind wallet-session authentication. Only an explicit owner approval can dispatch. */
export function createLeashDispatchRoutes() {
  return new Hono<AppEnv>()
    .post('/approve', async (c) => {
      if (!leashAvailable(c.env)) throw new AppError('EXECUTION_DISABLED', 'Leash execution is not configured.');
      const input = z.strictObject({ quoteResponse: z.unknown() }).parse(await c.req.json());
      if (!(await verifyOneClickQuoteSignature(input.quoteResponse)))
        throw new AppError('INVALID_REQUEST', 'Provider signature required.');
      const owner = c.get('account');
      const { config, vault } = await leashSnapshot(c.env, owner);
      await assertCode(c.env, config.rpcUrl, config.contract);
      const quote = validateLeashQuote(input.quoteResponse, owner, vault);
      const q = JSON.parse(quote) as { destinationAsset: string; recipient: string };
      const deps = executionDeps(c.env);
      const asset = deps.assets.byId(q.destinationAsset);
      if (!asset || !['near', 'eth', 'base', 'arb'].includes(asset.chain))
        throw new AppError('FORBIDDEN', 'Delivery cannot be independently verified.');
      const token = tokenContractOf(asset.canonicalId);
      if (asset.chain === 'near' && !token) throw new AppError('FORBIDDEN', 'Destination token cannot be verified.');
      const baseline = asset.chain === 'near' && token ? await deps.chain.ftBalance(token, q.recipient) : null;
      const request: LeashRequest = {
        network: 'mainnet',
        signerId: config.agent,
        receiverId: config.contract,
        methodName: 'execute',
        args: { owner, quote, signature: (input.quoteResponse as { signature: string }).signature },
        gas: '100000000000000',
        deposit: '0',
      };
      const id = crypto.randomUUID();
      await c.env.DB.prepare(
        'INSERT INTO leash_approvals(id,owner,request_json,quote_response,balance_before,created_at_ms) VALUES(?,?,?,?,?,?)',
      )
        .bind(
          id,
          owner,
          JSON.stringify(request),
          JSON.stringify(input.quoteResponse),
          baseline?.toString() ?? null,
          Date.now(),
        )
        .run();
      return c.json({ id, status: 'approved-not-submitted', request }, 201);
    })
    .post('/executions/:id/submit', async (c) => {
      if (!leashAvailable(c.env)) throw new AppError('EXECUTION_DISABLED', 'Leash execution is not configured.');
      const row = await approved(c.env.DB, c.req.param('id'), c.get('account'));
      const request = JSON.parse(row.request_json) as LeashRequest;
      const { config } = await leashSnapshot(c.env, row.owner);
      const service = (c.env as Bindings).LEASH_SIGNER;
      if (!service) throw new AppError('EXECUTION_DISABLED', 'Signer unavailable.');
      const result = await submitLeash(
        {
          id: row.id,
          owner: row.owner,
          contract: request.receiverId,
          agent: request.signerId,
          quoteResponse: JSON.parse(row.quote_response),
        },
        {
          enabled: true,
          contractId: config.contract,
          agentAccountId: config.agent,
          signer: createLeashServiceSigner(service, config.agent, config.contract),
          journal: leashJournal(c.env.DB),
          authorize: async (input) => {
            const current = await leashSnapshot(c.env, row.owner);
            await assertCode(c.env, current.config.rpcUrl, current.config.contract);
            return validateLeashQuote(input.quoteResponse, row.owner, current.vault) === request.args.quote;
          },
        },
      );
      return c.json(result, 202);
    })
    .get('/executions/:id', async (c) => {
      const row = await approved(c.env.DB, c.req.param('id'), c.get('account'));
      const request = JSON.parse(row.request_json) as LeashRequest;
      const journal = await c.env.DB.prepare('SELECT state,tx_hash FROM leash_executions WHERE id=? AND owner=?')
        .bind(row.id, row.owner)
        .first<{ state: string; tx_hash: string | null }>();
      if (!journal) return c.json({ id: row.id, state: 'approved-not-submitted', settled: false });
      let hash = journal.tx_hash;
      const service = (c.env as Bindings).LEASH_SIGNER;
      if (!hash && service) {
        // Read recovery only: never invoke submission twice, including after timeout/crash.
        const response = await service.fetch(
          `https://leash-signer.internal/v1/executions/${encodeURIComponent(row.id)}`,
          { redirect: 'manual', signal: AbortSignal.timeout(8000) },
        );
        if (response.ok) {
          const result = z
            .object({
              txHash: z.string(),
              signerId: z.literal(request.signerId),
              contractId: z.literal(request.receiverId),
            })
            .safeParse(await response.json());
          if (result.success && isTxHash(result.data.txHash)) {
            hash = result.data.txHash;
            await c.env.DB.prepare(
              "UPDATE leash_executions SET tx_hash=?,state='submitted' WHERE id=? AND owner=? AND tx_hash IS NULL",
            )
              .bind(hash, row.id, row.owner)
              .run();
          }
        }
      }
      if (!hash) return c.json({ id: row.id, state: 'outcome-unknown', settled: false });
      const deps = executionDeps(c.env);
      if (!deps.executor)
        return c.json({ id: row.id, txHash: hash, state: 'submitted-reconciliation-disabled', settled: false });
      return c.json({
        id: row.id,
        txHash: hash,
        ...(await reconcileLeashDelivery(
          {
            request,
            txHash: hash,
            quoteResponse: JSON.parse(row.quote_response),
            recipientBalanceBeforeRaw: row.balance_before === null ? null : BigInt(row.balance_before),
          },
          { chain: deps.chain, evm: deps.evm, assets: deps.assets, executor: deps.executor },
        )),
      });
    });
}
