import { createRheaLending, RHEA_LENDING_CONTRACT, type RheaSupplyPlan } from '@harbor/adapters/rhea/lending';
import { AppError } from '@harbor/domain/errors';
import { createNearChain } from '@harbor/near/chain';
import { createAccessKeyReader, verifySignIn } from '@harbor/near/sign-in';
import { z } from 'zod';
import { decodeExecutionConfig } from '../config.ts';

type Status = 'prepared' | 'approved' | 'awaiting_signature' | 'confirmed' | 'outcome_unknown' | 'cancelled';
interface Row {
  id: string;
  account_id: string;
  body: string;
  digest: string;
  message: string;
  nonce: string;
  recipient: string;
  status: Status;
  tx_hash: string | null;
  created_at_ms: number;
  expires_at_ms: number;
}
const Key = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const Hash = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);

function enabled(env: Env) {
  const config = decodeExecutionConfig(env);
  if (config.network !== 'mainnet' || !config.executionEnabled || !config.writeAdapters.has('rhea-lending')) {
    throw new AppError(
      'EXECUTION_DISABLED',
      'Rhea execution is disabled. An operator must enable the validated lending adapter.',
    );
  }
  return config;
}
async function read(env: Env, owner: string, id: string) {
  const row = await env.DB.prepare('SELECT * FROM rhea_supply_plans WHERE id=? AND account_id=? AND network=?')
    .bind(id, owner, 'mainnet')
    .first<Row>();
  if (!row) throw new AppError('NOT_FOUND', 'No such Rhea supply plan.');
  return row;
}
function publicRow(row: Row) {
  const plan = JSON.parse(row.body) as RheaSupplyPlan;
  // Transaction instructions are issued only by the single-use claim route.
  return {
    id: row.id,
    digest: row.digest,
    message: row.message,
    nonce: row.nonce,
    recipient: row.recipient,
    status: row.status,
    txHash: row.tx_hash,
    expiresAt: row.expires_at_ms,
    amount: plan.amount,
    tokenId: plan.tokenId,
    signerId: plan.signerId,
  };
}
export async function readSupply(env: Env, owner: string, id: string) {
  return publicRow(await read(env, owner, id));
}

export async function createSupply(env: Env, owner: string, recipient: string, key: string, plan: RheaSupplyPlan) {
  enabled(env);
  Key.parse(key);
  if (plan.signerId !== owner) throw new AppError('FORBIDDEN', 'Plan belongs to another account.');
  const previous = await env.DB.prepare(
    'SELECT * FROM rhea_supply_plans WHERE account_id=? AND network=? AND idempotency_key=?',
  )
    .bind(owner, 'mainnet', key)
    .first<Row>();
  if (previous) {
    const old = JSON.parse(previous.body) as RheaSupplyPlan;
    if (old.tokenId !== plan.tokenId || old.amount !== plan.amount || previous.recipient !== recipient)
      throw new AppError('CONFLICT', 'Idempotency key was already used for another supply.');
    return publicRow(previous);
  }
  const id = crypto.randomUUID();
  const body = JSON.stringify(plan);
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`harbor.rhea.supply.v1\0${id}\0${recipient}\0${body}`),
  );
  const digest = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const message = `Approve ONE Harbor Rhea supply on NEAR mainnet.\nOwner: ${owner}\nToken: ${plan.tokenId}\nAmount (atomic units): ${plan.amount}\nDestination: ${RHEA_LENDING_CONTRACT}\nSupply only, not collateral. Protocol risk and withdrawal availability apply.\nExpires: ${new Date(plan.expiresAt).toISOString()}\nPlan: ${id}\nDigest: ${digest}\nThis message moves no funds; a separate wallet transaction is required. No recurring or agent authority.`;
  await env.DB.prepare(
    'INSERT INTO rhea_supply_plans(id,network,account_id,idempotency_key,body,digest,message,nonce,recipient,status,created_at_ms,expires_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
  )
    .bind(id, 'mainnet', owner, key, body, digest, message, nonce, recipient, 'prepared', Date.now(), plan.expiresAt)
    .run();
  return readSupply(env, owner, id);
}

export async function approveSupply(
  env: Env,
  owner: string,
  id: string,
  input: { digest: string; publicKey: string; signature: string },
  recipient: string,
) {
  const config = enabled(env);
  const row = await read(env, owner, id);
  if (
    row.status !== 'prepared' ||
    row.expires_at_ms <= Date.now() ||
    row.digest !== input.digest ||
    row.recipient !== recipient
  )
    throw new AppError('CONFLICT', 'The Rhea approval is stale or does not match this plan.');
  try {
    await verifySignIn(
      {
        accountId: owner,
        publicKey: input.publicKey,
        signature: input.signature,
        message: row.message,
        recipient: row.recipient,
        nonce: Uint8Array.from(atob(row.nonce), (c) => c.charCodeAt(0)),
      },
      createAccessKeyReader(config.rpcUrl),
    );
  } catch {
    throw new AppError('UNAUTHORIZED', 'Could not verify the supply approval signature.');
  }
  const result = await env.DB.prepare(
    "UPDATE rhea_supply_plans SET status='approved' WHERE id=? AND account_id=? AND status='prepared' AND expires_at_ms>?",
  )
    .bind(id, owner, Date.now())
    .run();
  if (result.meta.changes !== 1) throw new AppError('CONFLICT', 'This approval was already consumed or expired.');
  return readSupply(env, owner, id);
}

/** Atomically issue this wallet request once. A lost response is not permission to resend funds. */
export async function claimSupply(env: Env, owner: string, id: string) {
  const config = enabled(env);
  const row = await read(env, owner, id);
  if (row.status !== 'approved' || row.expires_at_ms <= Date.now())
    throw new AppError('CONFLICT', 'Supply is not approved or expired.');
  const plan = JSON.parse(row.body) as RheaSupplyPlan;
  await createRheaLending(config.rpcUrl).prepareSupply({
    network: 'near:mainnet',
    accountId: owner,
    tokenId: plan.tokenId,
    amount: BigInt(plan.amount),
  });
  const result = await env.DB.prepare(
    "UPDATE rhea_supply_plans SET status='awaiting_signature' WHERE id=? AND account_id=? AND status='approved' AND expires_at_ms>?",
  )
    .bind(id, owner, Date.now())
    .run();
  if (result.meta.changes !== 1) throw new AppError('CONFLICT', 'The wallet request was already issued or expired.');
  return { ...publicRow({ ...row, status: 'awaiting_signature' }), transaction: plan.transaction };
}

export async function cancelSupply(env: Env, owner: string, id: string) {
  await read(env, owner, id);
  await env.DB.prepare(
    "UPDATE rhea_supply_plans SET status='cancelled' WHERE id=? AND account_id=? AND status IN ('prepared','approved')",
  )
    .bind(id, owner)
    .run();
  return readSupply(env, owner, id);
}

/** Independent final chain receipt verification, including the FT resolver's used amount.
 * A refunded/partially used transfer never counts as a confirmed supply.
 */
export async function settleSupply(env: Env, owner: string, id: string, txHash: string) {
  Hash.parse(txHash);
  const row = await read(env, owner, id);
  if (!['awaiting_signature', 'outcome_unknown', 'confirmed'].includes(row.status))
    throw new AppError('CONFLICT', 'The wallet request was not issued.');
  if (row.tx_hash && row.tx_hash !== txHash)
    throw new AppError('CONFLICT', 'Another transaction is already bound to this plan.');
  if (row.status === 'confirmed') return publicRow(row);
  const config = decodeExecutionConfig(env);
  if (config.network !== 'mainnet') throw new AppError('UNAVAILABLE', 'Rhea mainnet reader required.');
  const raw = await createNearChain(config.rpcUrl).transaction(txHash, owner);
  const parsed = z
    .object({
      final_execution_status: z.string(),
      transaction_outcome: z.object({ block_hash: z.string() }),
      transaction: z.object({
        hash: z.string(),
        signer_id: z.string(),
        receiver_id: z.string(),
        actions: z.array(z.unknown()),
      }),
      status: z.record(z.string(), z.unknown()),
      receipts_outcome: z.array(
        z.object({ outcome: z.object({ executor_id: z.string(), status: z.record(z.string(), z.unknown()) }) }),
      ),
    })
    .safeParse(raw);
  if (!parsed.success) return { ...publicRow(row), verification: 'pending' };
  const data = parsed.data;
  const plan = JSON.parse(row.body) as RheaSupplyPlan;
  const call = z
    .object({
      FunctionCall: z.object({
        method_name: z.string(),
        args: z.string(),
        deposit: z.string(),
        gas: z.union([z.string(), z.number()]),
      }),
    })
    .safeParse(data.transaction.actions[0]);
  let args: unknown;
  try {
    args = call.success ? JSON.parse(atob(call.data.FunctionCall.args)) : null;
  } catch {
    args = null;
  }
  const a = z
    .strictObject({ receiver_id: z.literal(RHEA_LENDING_CONTRACT), amount: z.literal(plan.amount), msg: z.literal('') })
    .safeParse(args);
  if (
    data.transaction.hash !== txHash ||
    data.transaction.signer_id !== owner ||
    data.transaction.receiver_id !== plan.tokenId ||
    data.transaction.actions.length !== 1 ||
    !call.success ||
    call.data.FunctionCall.method_name !== 'ft_transfer_call' ||
    call.data.FunctionCall.deposit !== '1' ||
    String(call.data.FunctionCall.gas) !== '100000000000000' ||
    !a.success
  )
    throw new AppError('INVALID_REQUEST', 'Transaction does not match the approved Rhea supply.');
  let used: unknown;
  try {
    used = typeof data.status.SuccessValue === 'string' ? JSON.parse(atob(data.status.SuccessValue)) : null;
  } catch {
    used = null;
  }
  const blockResponse = await fetch(config.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(8_000),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'rhea-settlement-block',
      method: 'block',
      params: { block_id: data.transaction_outcome.block_hash },
    }),
  });
  if (!blockResponse.ok) throw new AppError('UNAVAILABLE', 'Could not verify the supply block.');
  const block = z
    .object({ result: z.object({ header: z.object({ timestamp_nanosec: z.string().regex(/^[0-9]+$/) }) }) })
    .safeParse(await blockResponse.json());
  if (!block.success) throw new AppError('UNAVAILABLE', 'Could not verify the supply timestamp.');
  const blockMs = BigInt(block.data.result.header.timestamp_nanosec) / 1_000_000n;
  if (blockMs < BigInt(row.created_at_ms))
    throw new AppError('INVALID_REQUEST', 'Transaction predates this supply plan.');
  const confirmed =
    data.final_execution_status === 'FINAL' &&
    used === plan.amount &&
    data.receipts_outcome.some(
      (r) => r.outcome.executor_id === RHEA_LENDING_CONTRACT && 'SuccessValue' in r.outcome.status,
    ) &&
    data.receipts_outcome.every((r) => !('Failure' in r.outcome.status));
  // Reserve the hash even when settlement is ambiguous. UNIQUE prevents replay across plans.
  await env.DB.prepare(
    "UPDATE rhea_supply_plans SET tx_hash=?,status=? WHERE id=? AND account_id=? AND status IN ('awaiting_signature','outcome_unknown') AND (tx_hash IS NULL OR tx_hash=?)",
  )
    .bind(txHash, confirmed ? 'confirmed' : 'outcome_unknown', id, owner, txHash)
    .run();
  return readSupply(env, owner, id);
}
