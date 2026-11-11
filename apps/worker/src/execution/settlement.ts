import type { SettlementReport } from '@harbor/adapters/venue';
import { rawFromText } from '@harbor/domain/amount';
import { AppError } from '@harbor/domain/errors';
import { ChainReadFailed, checkDeposit, isTxHash, tokenContractOf } from '@harbor/near/chain';

import { verifyDelivery } from './delivery.ts';
import { readPlan } from './lifecycle.ts';
import {
  type ExecutionDeps,
  loadIntent,
  loadOwnPlan,
  loadPlan,
  loadQuote,
  logFailure,
  type Patch,
  type PlanRow,
  type PlanStatus,
  transition,
} from './store.ts';

const MAX_PLANS_PER_TICK = 25;
/** A claimed transaction NEAR still does not know after this was never sent. */
const UNSEEN_DEPOSIT_MS = 30 * 60_000;
/** After this long without a readable status or a verifiable delivery, the outcome is unknown. */
const STALE_MS = 2 * 60 * 60_000;
const WAITING_FOR_DEPOSIT: readonly PlanStatus[] = ['awaiting_signature', 'expired'];

/**
 * Records the deposit transaction the owner's wallet sent for an approved plan. The hash is claimed
 * first, so a deposit is never lost when NEAR cannot be read right now; the plan moves on only once
 * the chain shows exactly the planned transfer. A deposit that lands after the approval window still
 * counts: funds that moved are never ignored.
 */
export async function recordDeposit(deps: ExecutionDeps, planId: string, account: string, txHash: string) {
  if (!isTxHash(txHash)) throw new AppError('INVALID_REQUEST', 'Send the deposit transaction hash.');
  let plan = await loadOwnPlan(deps, planId, account);
  if (plan.tx_hash !== null && plan.tx_hash !== txHash) {
    throw new AppError('CONFLICT', 'This plan already has a deposit transaction.');
  }
  if (plan.tx_hash === null) {
    if (!WAITING_FOR_DEPOSIT.includes(plan.status) || !plan.deposit_address) {
      throw new AppError('CONFLICT', 'This plan is not waiting for a deposit.');
    }
    try {
      await deps.db
        .prepare(
          `UPDATE plans SET tx_hash = ?, updated_at_ms = ? WHERE id = ? AND tx_hash IS NULL
           AND status IN ('awaiting_signature', 'expired')`,
        )
        .bind(txHash, deps.now(), plan.id)
        .run();
    } catch {
      throw new AppError('CONFLICT', 'That transaction is already recorded for another plan.');
    }
    plan = await loadPlan(deps, plan.id);
    if (plan.tx_hash !== txHash) throw new AppError('CONFLICT', 'This plan changed. Reload it.');
  }
  if (WAITING_FOR_DEPOSIT.includes(plan.status)) {
    const outcome = await checkClaimedDeposit(deps, plan);
    if (outcome.mismatch) throw new AppError('CONFLICT', outcome.mismatch);
  }
  return readPlan(deps, plan.id, account);
}

/**
 * The cron's settlement pass: verifies claimed deposits, then follows each in-flight swap with the
 * provider and checks its delivery on the destination chain before calling it confirmed.
 */
export async function settlePlans(deps: ExecutionDeps) {
  const summary = { deposits: 0, followed: 0 };
  const claimed = await deps.db
    .prepare(
      `SELECT * FROM plans WHERE network = ? AND tx_hash IS NOT NULL AND status IN ('awaiting_signature', 'expired')
       ORDER BY updated_at_ms LIMIT ?`,
    )
    .bind(deps.config.network, MAX_PLANS_PER_TICK)
    .all<PlanRow>();
  for (const plan of claimed.results) {
    summary.deposits += 1;
    await checkClaimedDeposit(deps, plan).catch((error) => logFailure('deposit_check', error));
  }
  const inFlight = await deps.db
    .prepare(
      `SELECT * FROM plans WHERE network = ? AND status IN ('submitted', 'confirming')
       ORDER BY updated_at_ms LIMIT ?`,
    )
    .bind(deps.config.network, MAX_PLANS_PER_TICK)
    .all<PlanRow>();
  for (const plan of inFlight.results) {
    summary.followed += 1;
    await follow(deps, plan).catch((error) => logFailure('settlement', error));
  }
  return summary;
}

/** Checks a claimed hash against the chain. Returns a reason when it is not this plan's deposit. */
async function checkClaimedDeposit(deps: ExecutionDeps, plan: PlanRow): Promise<{ mismatch?: string }> {
  const intent = await loadIntent(deps, plan.intent_id);
  const quote = await loadQuote(deps, plan.quote_id);
  const tokenContract = tokenContractOf(intent.sell_asset);
  if (!plan.tx_hash || !plan.deposit_address || !tokenContract) return {};
  let result: unknown;
  try {
    result = await deps.chain.transaction(plan.tx_hash, plan.account_id);
  } catch (error) {
    if (error instanceof ChainReadFailed) return {};
    throw error;
  }
  const check = checkDeposit(result, {
    signer: plan.account_id,
    tokenContract,
    depositAddress: plan.deposit_address,
    amountRaw: quote.amount_in_raw,
  });
  switch (check.outcome) {
    case 'confirmed': {
      const moved = await transition(
        deps,
        plan,
        'submitted',
        { error_code: null },
        'system',
        'Deposit verified on NEAR',
      );
      if (moved && deps.executor) {
        await deps.executor
          .submitDeposit({
            txHash: plan.tx_hash,
            depositAddress: plan.deposit_address,
            memo: plan.deposit_memo || null,
            sender: plan.account_id,
          })
          .catch((error) => logFailure('deposit_notice', error));
      }
      return {};
    }
    case 'failed':
      await transition(deps, plan, 'failed', { error_code: 'DEPOSIT_FAILED' }, 'system', check.detail);
      return {};
    case 'mismatch':
      await unclaim(deps, plan);
      return { mismatch: `That transaction is not this plan's deposit: ${check.detail}` };
    case 'pending':
      if (result === null && deps.now() - plan.updated_at_ms > UNSEEN_DEPOSIT_MS) await unclaim(deps, plan);
      return {};
  }
}

async function unclaim(deps: ExecutionDeps, plan: PlanRow) {
  await deps.db
    .prepare('UPDATE plans SET tx_hash = NULL, updated_at_ms = ? WHERE id = ? AND tx_hash = ? AND status = ?')
    .bind(deps.now(), plan.id, plan.tx_hash, plan.status)
    .run();
}

/** One step of an in-flight swap, from the provider's report and the destination chain. */
async function follow(deps: ExecutionDeps, plan: PlanRow) {
  if (!deps.executor || !plan.deposit_address || !plan.quote_hash) return;
  const stale = deps.now() - plan.updated_at_ms > STALE_MS;
  let report: SettlementReport;
  try {
    report = await deps.executor.status({
      depositAddress: plan.deposit_address,
      memo: plan.deposit_memo || null,
      quoteHash: plan.quote_hash,
    });
  } catch (error) {
    logFailure('status', error);
    if (stale) await move(deps, plan, 'outcome_unknown', { error_code: 'STATUS_UNAVAILABLE' }, 'No readable status');
    return;
  }
  const seen = { one_click_status: report.status };
  switch (report.status) {
    case 'PENDING_DEPOSIT':
    case 'KNOWN_DEPOSIT_TX':
    case 'PROCESSING':
      if (plan.status === 'submitted' || plan.one_click_status !== report.status) {
        await move(deps, plan, 'confirming', seen, `NEAR Intents reports ${report.status}`);
      }
      return;
    case 'REFUNDED':
      await move(
        deps,
        plan,
        'refunded',
        {
          ...seen,
          result: merge(plan, {
            refundedRaw: report.refundedAmount?.toString() ?? null,
            refundReason: report.refundReason?.slice(0, 200) ?? null,
          }),
        },
        'NEAR Intents refunded the deposit',
      );
      return;
    case 'FAILED':
      await move(deps, plan, 'failed', { ...seen, error_code: 'PROVIDER_FAILED' }, 'NEAR Intents reports a failure');
      return;
    case 'INCOMPLETE_DEPOSIT':
      await move(
        deps,
        plan,
        'outcome_unknown',
        { ...seen, error_code: 'INCOMPLETE_DEPOSIT' },
        'NEAR Intents saw less than the planned deposit',
      );
      return;
    case 'SUCCESS': {
      const intent = await loadIntent(deps, plan.intent_id);
      const quote = await loadQuote(deps, plan.quote_id);
      const before = (JSON.parse(plan.result ?? '{}') as { recipientBalanceBeforeRaw?: string | null })
        .recipientBalanceBeforeRaw;
      let delivered: Awaited<ReturnType<typeof verifyDelivery>>;
      try {
        delivered = await verifyDelivery(deps.chain, deps.evm, {
          chain: plan.recipient_chain ?? 'near',
          recipient: plan.recipient ?? plan.account_id,
          buyAsset: intent.buy_asset,
          minOutRaw: rawFromText(quote.min_out_raw),
          balanceBeforeRaw: before ? BigInt(before) : null,
          deliveryTxHashes: report.deliveryTxHashes,
        });
      } catch (error) {
        if (!(error instanceof ChainReadFailed)) throw error;
        delivered = { verified: false, reason: 'The destination chain could not be read.' };
      }
      if (delivered.verified) {
        await move(
          deps,
          plan,
          'confirmed',
          {
            ...seen,
            delivery_tx_hash: delivered.txHash,
            delivery_verified_at_ms: deps.now(),
            result: merge(plan, { receivedRaw: delivered.receivedRaw.toString() }),
          },
          'Delivery verified on the destination chain',
        );
      } else if (stale) {
        await move(
          deps,
          plan,
          'outcome_unknown',
          { ...seen, error_code: 'DELIVERY_UNVERIFIED' },
          `NEAR Intents reports success, but ${delivered.reason}`,
        );
      } else if (plan.status === 'submitted' || plan.one_click_status !== 'SUCCESS') {
        await move(deps, plan, 'confirming', seen, 'NEAR Intents reports success; checking the delivery');
      }
      return;
    }
  }
}

async function move(deps: ExecutionDeps, plan: PlanRow, to: PlanStatus, patch: Patch, reason: string) {
  await transition(deps, plan, to, patch, 'system', reason);
}

function merge(plan: PlanRow, values: Record<string, string | null>): string {
  return JSON.stringify({ ...(JSON.parse(plan.result ?? '{}') as Record<string, unknown>), ...values });
}
