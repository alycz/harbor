import {
  checkSupplyReceipt,
  createRheaReader,
  type RheaCall,
  type RheaMarket,
  type RheaReader,
  RheaReadFailed,
  registrationCall,
  supplyCall,
} from '@harbor/adapters/rhea/lending';
import { MAX_U128_RAW, parseDecimalAmount } from '@harbor/domain/amount';
import { type AssetRef, parseOneClickAssetId } from '@harbor/domain/asset';
import { AppError } from '@harbor/domain/errors';
import { isTxHash } from '@harbor/near/chain';

import { decodeExecutionConfig, type ExecutionConfig } from '../config.ts';
import { assetRegistry } from '../execution/assets.ts';

/**
 * Supplying a NEAR token to Rhea Lend, the same way a swap runs: the owner reviews the exact
 * transaction, approves it, signs it with their own wallet, and Harbor settles it only from the chain.
 * The tokens stay in the owner's own Rhea account as a plain supply, never collateral. Agents cannot
 * create or approve these; they are owner actions behind a session.
 */
const RHEA_ADAPTER = 'rhea-lending';
const REVIEW_WINDOW_MS = 10 * 60_000;
/** A transaction may not predate its plan by more than this, allowing for clock drift. */
const CLOCK_SKEW_MS = 2 * 60_000;

export interface LendingDeps {
  db: D1Database;
  config: ExecutionConfig;
  rhea: RheaReader;
  now(): number;
}

export function lendingDeps(env: unknown): LendingDeps {
  const config = decodeExecutionConfig(env);
  return { db: (env as { DB: D1Database }).DB, config, rhea: createRheaReader(config.rpcUrl), now: Date.now };
}

function rheaExecutionEnabled(config: ExecutionConfig): boolean {
  return config.network === 'mainnet' && config.executionEnabled && config.writeAdapters.has(RHEA_ADAPTER);
}

interface RheaAsset {
  asset: AssetRef;
  tokenId: string;
}

/** The verified NEAR tokens Harbor supplies. wNEAR is left out: wallets hold NEAR, not wNEAR. */
function rheaAssets(config: ExecutionConfig): RheaAsset[] {
  return assetRegistry(config.network)
    .list()
    .flatMap((asset) => {
      const identity = parseOneClickAssetId(asset.canonicalId);
      return asset.chain === 'near' && identity?.standard === 'nep141' && identity.contractId !== 'wrap.near'
        ? [{ asset, tokenId: identity.contractId }]
        : [];
    });
}

function resolveAsset(config: ExecutionConfig, symbolOrId: string): RheaAsset {
  const found = rheaAssets(config).find(
    (entry) => entry.asset.symbol === symbolOrId || entry.asset.canonicalId === symbolOrId,
  );
  if (!found) throw new AppError('INVALID_REQUEST', 'Harbor does not supply that token to Rhea.');
  return found;
}

function requireMainnet(config: ExecutionConfig) {
  if (config.network !== 'mainnet') throw new AppError('UNAVAILABLE', 'Rhea Lend runs on NEAR mainnet only.');
}

/** Reads the chain, turning a failed read into a retryable error that says nothing moved. */
async function read<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof RheaReadFailed) {
      throw new AppError('UNAVAILABLE', 'Rhea could not be read just now. Nothing has moved; try again.');
    }
    throw error;
  }
}

export interface RheaMarketView {
  symbol: string;
  assetId: string;
  tokenId: string;
  decimals: number;
  canDeposit: boolean;
  supplyAprPct: number | null;
  remainingCapRaw: string | null;
}

function marketView(entry: RheaAsset, market: RheaMarket): RheaMarketView {
  return {
    symbol: entry.asset.symbol,
    assetId: entry.asset.canonicalId,
    tokenId: entry.tokenId,
    decimals: entry.asset.decimals,
    canDeposit: market.canDeposit,
    supplyAprPct: market.supplyAprPct,
    remainingCapRaw: market.remainingCapRaw === null ? null : market.remainingCapRaw.toString(),
  };
}

/** What the owner needs before supplying: balance, position, registration and the market. */
export async function readAccount(deps: LendingDeps, accountId: string, symbolOrId: string) {
  requireMainnet(deps.config);
  const entry = resolveAsset(deps.config, symbolOrId);
  return read(async () => {
    const market = await deps.rhea.market(entry.tokenId);
    const [registered, balance, supplied] = await Promise.all([
      deps.rhea.registered(accountId),
      deps.rhea.tokenBalance(entry.tokenId, accountId),
      deps.rhea.supplied(accountId, entry.tokenId, market.extraDecimals),
    ]);
    const deposit = registered ? null : await deps.rhea.registrationDeposit();
    return {
      market: marketView(entry, market),
      balanceRaw: balance.toString(),
      suppliedRaw: supplied.toString(),
      registered,
      registration:
        deposit === null ? null : { depositYocto: deposit.toString(), call: registrationCall(accountId, deposit) },
      executionEnabled: rheaExecutionEnabled(deps.config),
    };
  });
}

type SupplyStatus =
  | 'awaiting_review'
  | 'awaiting_signature'
  | 'submitted'
  | 'confirmed'
  | 'refunded'
  | 'failed'
  | 'cancelled'
  | 'expired';

interface PlanRow {
  id: string;
  account_id: string;
  idempotency_key: string;
  token_id: string;
  symbol: string;
  decimals: number;
  extra_decimals: number;
  amount_raw: string;
  digest: string;
  status: SupplyStatus;
  tx_hash: string | null;
  created_at_ms: number;
  expires_at_ms: number;
}

export interface SupplyPlanView {
  id: string;
  status: SupplyStatus;
  symbol: string;
  tokenId: string;
  decimals: number;
  amountRaw: string;
  digest: string;
  txHash: string | null;
  explorerUrl: string | null;
  createdAt: string;
  expiresAt: string;
  /** The one transaction the wallet signs; present only while the plan waits for it. */
  signing: RheaCall | null;
}

function view(row: PlanRow): SupplyPlanView {
  return {
    id: row.id,
    status: row.status,
    symbol: row.symbol,
    tokenId: row.token_id,
    decimals: row.decimals,
    amountRaw: row.amount_raw,
    digest: row.digest,
    txHash: row.tx_hash,
    explorerUrl: row.tx_hash ? `https://nearblocks.io/txns/${row.tx_hash}` : null,
    createdAt: new Date(row.created_at_ms).toISOString(),
    expiresAt: new Date(row.expires_at_ms).toISOString(),
    signing: row.status === 'awaiting_signature' ? supplyCall(row.token_id, BigInt(row.amount_raw)) : null,
  };
}

async function loadOwn(deps: LendingDeps, accountId: string, id: string): Promise<PlanRow> {
  const row = await deps.db
    .prepare('SELECT * FROM rhea_supply_plans WHERE id = ? AND account_id = ? AND network = ?')
    .bind(id, accountId, deps.config.network)
    .first<PlanRow>();
  if (!row) throw new AppError('NOT_FOUND', 'No such deposit.');
  if (row.status === 'awaiting_review' && row.expires_at_ms <= deps.now()) {
    await setStatus(deps, row, 'expired');
    return { ...row, status: 'expired' };
  }
  return row;
}

/** Moves the plan only from the status it was read in, so two requests cannot both move it. */
async function setStatus(deps: LendingDeps, row: PlanRow, status: SupplyStatus, txHash: string | null = row.tx_hash) {
  const result = await deps.db
    .prepare(
      `UPDATE rhea_supply_plans SET status = ?, tx_hash = ?, updated_at_ms = ?
       WHERE id = ? AND status = ? AND (tx_hash IS NULL OR tx_hash = ?)`,
    )
    .bind(status, txHash, deps.now(), row.id, row.status, txHash)
    .run();
  if (result.meta.changes !== 1) throw new AppError('CONFLICT', 'This deposit changed in the meantime. Reload it.');
}

/** Everything that must hold, right now on chain, for this supply to go through. */
async function checkSupplyable(deps: LendingDeps, accountId: string, entry: RheaAsset, amountRaw: bigint) {
  const market = await deps.rhea.market(entry.tokenId);
  if (!market.canDeposit) {
    throw new AppError('UNAVAILABLE', `Rhea is not accepting ${entry.asset.symbol} deposits right now.`);
  }
  if (market.remainingCapRaw !== null && amountRaw > market.remainingCapRaw) {
    throw new AppError(
      'INVALID_REQUEST',
      `Rhea's ${entry.asset.symbol} market is close to its cap. Try a smaller amount.`,
    );
  }
  const [registered, balance] = await Promise.all([
    deps.rhea.registered(accountId),
    deps.rhea.tokenBalance(entry.tokenId, accountId),
  ]);
  if (!registered) throw new AppError('SETUP_REQUIRED', 'Register with Rhea first. It is a one-time step.');
  if (balance < amountRaw) {
    throw new AppError('INVALID_REQUEST', `Your wallet holds less ${entry.asset.symbol} on NEAR than that.`);
  }
  return market;
}

export async function createPlan(
  deps: LendingDeps,
  accountId: string,
  input: { asset: string; amount: string },
  idempotencyKey: string,
): Promise<SupplyPlanView> {
  requireMainnet(deps.config);
  const entry = resolveAsset(deps.config, input.asset);
  let amountRaw: bigint;
  try {
    amountRaw = parseDecimalAmount(input.amount, entry.asset.decimals, MAX_U128_RAW);
  } catch {
    throw new AppError(
      'INVALID_REQUEST',
      `Enter an amount of ${entry.asset.symbol} with at most ${entry.asset.decimals} decimals.`,
    );
  }
  if (amountRaw <= 0n) throw new AppError('INVALID_REQUEST', 'Enter an amount above zero.');

  const previous = await deps.db
    .prepare('SELECT * FROM rhea_supply_plans WHERE network = ? AND account_id = ? AND idempotency_key = ?')
    .bind(deps.config.network, accountId, idempotencyKey)
    .first<PlanRow>();
  if (previous) {
    if (previous.token_id !== entry.tokenId || previous.amount_raw !== amountRaw.toString()) {
      throw new AppError('CONFLICT', 'That request was already used for a different deposit.');
    }
    return view(previous);
  }

  const market = await read(() => checkSupplyable(deps, accountId, entry, amountRaw));
  const id = crypto.randomUUID();
  const now = deps.now();
  const digest = await sha256Hex(
    JSON.stringify({
      domain: 'harbor.rhea.supply.v1',
      id,
      network: deps.config.network,
      accountId,
      call: supplyCall(entry.tokenId, amountRaw),
    }),
  );
  const row: PlanRow = {
    id,
    account_id: accountId,
    idempotency_key: idempotencyKey,
    token_id: entry.tokenId,
    symbol: entry.asset.symbol,
    decimals: entry.asset.decimals,
    extra_decimals: market.extraDecimals,
    amount_raw: amountRaw.toString(),
    digest,
    status: 'awaiting_review',
    tx_hash: null,
    created_at_ms: now,
    expires_at_ms: now + REVIEW_WINDOW_MS,
  };
  await deps.db
    .prepare(
      `INSERT INTO rhea_supply_plans (id, network, account_id, idempotency_key, token_id, symbol, decimals,
         extra_decimals, amount_raw, digest, status, created_at_ms, expires_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      deps.config.network,
      accountId,
      idempotencyKey,
      row.token_id,
      row.symbol,
      row.decimals,
      row.extra_decimals,
      row.amount_raw,
      digest,
      row.status,
      now,
      row.expires_at_ms,
      now,
    )
    .run();
  return view(row);
}

export async function readPlan(deps: LendingDeps, accountId: string, id: string): Promise<SupplyPlanView> {
  return view(await loadOwn(deps, accountId, id));
}

/** The owner approves the exact transaction they reviewed; the wallet signs it next. */
export async function approvePlan(
  deps: LendingDeps,
  accountId: string,
  id: string,
  input: { digest: string },
): Promise<SupplyPlanView> {
  if (!rheaExecutionEnabled(deps.config)) {
    throw new AppError('EXECUTION_DISABLED', 'Rhea deposits are turned off on this server.');
  }
  const row = await loadOwn(deps, accountId, id);
  if (row.status === 'expired') throw new AppError('CONFLICT', 'This review expired. Start the deposit again.');
  if (row.status !== 'awaiting_review') throw new AppError('CONFLICT', 'This deposit is not waiting for review.');
  if (input.digest !== row.digest) throw new AppError('CONFLICT', 'The deposit changed since you reviewed it.');
  const entry = resolveAsset(deps.config, row.symbol);
  await read(() => checkSupplyable(deps, accountId, entry, BigInt(row.amount_raw)));
  await setStatus(deps, row, 'awaiting_signature');
  return view({ ...row, status: 'awaiting_signature' });
}

/**
 * Records the transaction the owner's wallet sent and settles it from the chain. A hash is bound to
 * the plan only once the chain shows it is this plan's transaction; until then nothing changes.
 */
export async function submitPlan(
  deps: LendingDeps,
  accountId: string,
  id: string,
  txHash: string,
): Promise<SupplyPlanView & { verification: 'pending' | 'settled' }> {
  if (!isTxHash(txHash)) throw new AppError('INVALID_REQUEST', 'That is not a NEAR transaction hash.');
  const row = await loadOwn(deps, accountId, id);
  if (row.tx_hash && row.tx_hash !== txHash) {
    throw new AppError('CONFLICT', 'A different transaction is already recorded for this deposit.');
  }
  if (row.status === 'confirmed' || row.status === 'refunded' || row.status === 'failed') {
    return { ...view(row), verification: 'settled' };
  }
  if (row.status !== 'awaiting_signature' && row.status !== 'submitted') {
    throw new AppError('CONFLICT', 'This deposit was not approved for signing.');
  }

  const result = await read(() => deps.rhea.transaction(txHash, accountId));
  if (result === null) return { ...view(row), verification: 'pending' };
  const outcome = checkSupplyReceipt(result, {
    txHash,
    accountId,
    tokenId: row.token_id,
    amountRaw: BigInt(row.amount_raw),
    extraDecimals: row.extra_decimals,
  });
  if (outcome === 'mismatch') throw new AppError('INVALID_REQUEST', 'That transaction is not this deposit.');
  const blockHash = (result as { transaction_outcome: { block_hash: string } }).transaction_outcome.block_hash;
  const blockMs = await read(() => deps.rhea.blockTimestampMs(blockHash));
  if (blockMs < row.created_at_ms - CLOCK_SKEW_MS) {
    throw new AppError('INVALID_REQUEST', 'That transaction is older than this deposit.');
  }

  const status: SupplyStatus = outcome === 'pending' ? 'submitted' : outcome;
  if (status !== row.status || row.tx_hash !== txHash) {
    try {
      await setStatus(deps, row, status, txHash);
    } catch (error) {
      if (error instanceof Error && /UNIQUE/i.test(error.message)) {
        throw new AppError('CONFLICT', 'That transaction is already recorded for another deposit.');
      }
      throw error;
    }
  }
  return {
    ...view({ ...row, status, tx_hash: txHash }),
    verification: outcome === 'pending' ? 'pending' : 'settled',
  };
}

export async function cancelPlan(deps: LendingDeps, accountId: string, id: string): Promise<SupplyPlanView> {
  const row = await loadOwn(deps, accountId, id);
  if (row.status === 'cancelled' || row.status === 'expired') return view(row);
  if (row.status !== 'awaiting_review') {
    throw new AppError('CONFLICT', 'Only a deposit still in review can be cancelled.');
  }
  await setStatus(deps, row, 'cancelled');
  return view({ ...row, status: 'cancelled' });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
