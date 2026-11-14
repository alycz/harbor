import { AppError } from '@harbor/domain/errors';
import { createAccessKeyReader, verifySignIn } from '@harbor/near/sign-in';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app.ts';
import { recipientOf, requireSession } from '../auth/guard.ts';
import { decodeExecutionConfig } from '../config.ts';
import { verifyTemplarMarket } from './markets.ts';
import { reader } from './routes.ts';

const Input = z.strictObject({ marketId: z.string().min(2).max(64),
  amountAtomic: z.string().max(39).regex(/^[1-9][0-9]*$/).refine(v => BigInt(v) < 2n ** 128n) });
type Row = { id: string; account: string; market: string; amount: string; payload: string;
  digest: string; nonce: string; recipient: string; expires: number; state: string; tx_hash: string | null };

function gate(env: unknown) {
  const config = decodeExecutionConfig(env);
  if (config.network !== 'mainnet' || !config.executionEnabled || !config.writeAdapters.has('templar'))
    throw new AppError('EXECUTION_DISABLED', 'Templar execution is disabled.');
  return config;
}
async function hash(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
function message(row: Row) {
  return 'Approve ONE Templar borrow. This creates debt and liquidation risk.\n' + row.payload + '\nDigest: ' + row.digest;
}
async function owned(db: D1Database, id: string, account: string) {
  const row = await db.prepare('SELECT * FROM templar_borrow_plans WHERE id = ? AND account = ?').bind(id, account).first<Row>();
  if (!row) throw new AppError('NOT_FOUND', 'Borrow plan not found.');
  return row;
}
function publicPlan(row: Row) {
  return { id: row.id, accountId: row.account, state: row.state, digest: row.digest,
    expiresAt: new Date(row.expires).toISOString(), binding: JSON.parse(row.payload) as unknown,
    challenge: { message: message(row), nonce: row.nonce, recipient: row.recipient }, txHash: row.tx_hash };
}
export function createTemplarBorrowRoutes() {
  return new Hono<AppEnv>()
    .use('*', requireSession)
    .post('/', async c => {
      const input = Input.safeParse(await c.req.json().catch(() => null));
      if (!input.success) throw new AppError('INVALID_REQUEST', 'Send marketId and positive atomic amount.');
      const {marketId, amountAtomic} = input.data;
      const config = gate(c.env);
      const view = reader(config.rpcUrl);
      const {client,configuration} = await verifyTemplarMarket(view,marketId,config.rpcUrl);
      if (await client.registration(marketId, c.get('account')))
        throw new AppError('SETUP_REQUIRED', 'Register on the market before creating a borrow plan.');
      const transaction = await client.borrow(marketId, amountAtomic);
      const id = crypto.randomUUID(), expires = Date.now() + 120000;
      const payload = JSON.stringify({domain:'harbor.templar.borrow.v1', id, network:'mainnet',
        account:c.get('account'), marketId, amountAtomic, expires, configuration, transaction});
      const digest = await hash(payload);
      const nonce = btoa(Array.from(crypto.getRandomValues(new Uint8Array(32)), b => String.fromCharCode(b)).join(''));
      const row: Row = {id, account:c.get('account'), market:marketId, amount:amountAtomic,
        payload,digest,nonce,recipient:recipientOf(c),expires,state:'prepared',tx_hash:null};
      await c.env.DB.prepare('INSERT INTO templar_borrow_plans (id,account,market,amount,payload,digest,nonce,recipient,expires,state) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .bind(id,row.account,marketId,amountAtomic,payload,digest,nonce,row.recipient,expires,row.state).run();
      return c.json(publicPlan(row),201);
    })
    .get('/:id', async c => c.json(publicPlan(await owned(c.env.DB,c.req.param('id'),c.get('account')))))
    .post('/:id/approve', async c => {
      const row = await owned(c.env.DB,c.req.param('id'),c.get('account'));
      const config = gate(c.env);
      const signed = z.strictObject({digest:z.string(),publicKey:z.string().max(128),signature:z.string().max(256)})
        .safeParse(await c.req.json().catch(() => null));
      if (!signed.success || signed.data.digest !== row.digest || row.recipient !== recipientOf(c))
        throw new AppError('INVALID_REQUEST','Approval does not match the reviewed plan.');
      if (row.state !== 'prepared' || row.expires <= Date.now()) throw new AppError('CONFLICT','Plan already used or expired. Create a fresh plan.');
      const binding = JSON.parse(row.payload);
      const {configuration} = await verifyTemplarMarket(reader(config.rpcUrl),row.market,config.rpcUrl);
      if (JSON.stringify(configuration) !== JSON.stringify(binding.configuration))
        throw new AppError('CONFLICT','Market configuration changed. Review a new plan.');
      await verifySignIn({accountId:row.account,publicKey:signed.data.publicKey,signature:signed.data.signature,
        message:message(row),recipient:row.recipient,nonce:Uint8Array.from(atob(row.nonce),v=>v.charCodeAt(0))},
        createAccessKeyReader(config.rpcUrl));
      const updated = await c.env.DB.prepare("UPDATE templar_borrow_plans SET state='issued' WHERE id=? AND state='prepared' AND expires>?")
        .bind(row.id,Date.now()).run();
      if (updated.meta.changes !== 1) throw new AppError('CONFLICT','Plan already issued or expired. Do not resend.');
      return c.json({id:row.id,state:'issued',transaction:binding.transaction});
    })
    .post('/:id/receipt', async c => {
      const row = await owned(c.env.DB,c.req.param('id'),c.get('account'));
      const input = z.strictObject({txHash:z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/)})
        .safeParse(await c.req.json().catch(() => null));
      if (!input.success) throw new AppError('INVALID_REQUEST','Send transaction hash.');
      if (row.state !== 'issued' && row.state !== 'confirmed') throw new AppError('CONFLICT','Plan was not approved.');
      if (row.tx_hash && row.tx_hash !== input.data.txHash) throw new AppError('CONFLICT','Plan already has another transaction.');
      // Receipt reads remain available when execution is disabled.
      const config = decodeExecutionConfig(c.env);
      if (config.network !== 'mainnet') throw new AppError('CONFLICT','Wrong network.');
      const response = await fetch(config.rpcUrl,{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',id:'templar-receipt',method:'tx',
          params:{tx_hash:input.data.txHash,sender_account_id:row.account,wait_until:'FINAL'}}),
        signal:AbortSignal.timeout(8000),redirect:'manual'});
      if (!response.ok) throw new AppError('UNAVAILABLE','Receipt lookup unavailable; do not resend.');
      const body = await response.json() as {result?: unknown};
      const checked = checkBorrowReceipt(body.result,row.account,row.market,row.amount,input.data.txHash);
      if (checked !== 'confirmed') return c.json({id:row.id,state:checked,txHash:input.data.txHash,
        detail:'Not confirmed. Inspect wallet activity before retrying; do not resubmit the borrow.'});
      const result = await c.env.DB.prepare("UPDATE templar_borrow_plans SET state='confirmed',tx_hash=? WHERE id=? AND state IN ('issued','confirmed') AND (tx_hash IS NULL OR tx_hash=?)")
        .bind(input.data.txHash,row.id,input.data.txHash).run();
      if(result.meta.changes !== 1) throw new AppError('CONFLICT','Receipt was not recorded.');
      return c.json({id:row.id,state:'confirmed',txHash:input.data.txHash,
        detail:'Exact approved borrow and all receipts finalized successfully. This is loan origination, not repayment or closure.'});
    });
}

/** Final chain evidence, not a wallet callback, determines confirmation. */
export function checkBorrowReceipt(value: unknown, account: string, market: string, amount: string, txHash: string) {
  const Call = z.object({FunctionCall:z.object({method_name:z.string(),args:z.string(),deposit:z.string(),gas:z.union([z.string(),z.number()])})});
  const parsed = z.object({final_execution_status:z.literal('FINAL'),
    transaction:z.object({hash:z.string(),signer_id:z.string(),receiver_id:z.string(),actions:z.array(Call)}),
    status:z.record(z.string(),z.unknown()),
    receipts_outcome:z.array(z.object({outcome:z.object({status:z.record(z.string(),z.unknown())})})).min(1)}).safeParse(value);
  if(!parsed.success) return 'pending';
  const tx = parsed.data.transaction;
  const action = tx.actions[0]?.FunctionCall;
  if(tx.hash !== txHash || tx.signer_id !== account || tx.receiver_id !== market || tx.actions.length !== 1 ||
    !action || action.method_name !== 'borrow' || action.deposit !== '0' || String(action.gas) !== '100000000000000') return 'mismatch';
  try {
    const args = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(action.args),v=>v.charCodeAt(0))));
    if(Object.keys(args).length !== 1 || args.amount !== amount) return 'mismatch';
  } catch { return 'mismatch'; }
  if('Failure' in parsed.data.status || parsed.data.receipts_outcome.some(r=>'Failure' in r.outcome.status)) return 'failed';
  if(!('SuccessValue' in parsed.data.status) || parsed.data.receipts_outcome.some(r=>!('SuccessValue' in r.outcome.status) && !('SuccessReceiptId' in r.outcome.status))) return 'pending';
  return 'confirmed';
}
