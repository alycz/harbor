import { TemplarClient, type TemplarView } from '@harbor/adapters/templar/client';
import { AppError } from '@harbor/domain/errors';
import { z } from 'zod';

const REGISTRY = 'v1.tmplr.near';
/** Templar's catalogue and withdrawn versions change rarely; reading them on every request trips RPC limits. */
const CACHE_MS = 10 * 60_000;

/** One cached value per isolate. A failed read is dropped at once, so the next request tries again. */
function cached<T>(load: () => Promise<T>): () => Promise<T> {
  let entry: { at: number; value: Promise<T> } | null = null;
  return () => {
    if (!entry || Date.now() - entry.at > CACHE_MS) {
      const value = load();
      entry = { at: Date.now(), value };
      value.catch(() => {
        if (entry?.value === value) entry = null;
      });
    }
    return entry.value;
  };
}
/**
 * Official active-market catalogue, not an operator-maintained allowlist.
 * Registry membership alone is insufficient: retired markets remain fully functional.
 * Source: https://docs.templarfi.org/guide/addresses.html
 * Fail closed on catalogue changes/outages rather than treating every deployment as active.
 */
export const activeTemplarMarkets = cached(readActiveMarkets);

async function readActiveMarkets(): Promise<Set<string>> {
  const response = await fetch('https://docs.templarfi.org/guide/addresses.html', {
    signal: AbortSignal.timeout(8000),
    redirect: 'manual',
  });
  if (!response.ok) throw new AppError('UNAVAILABLE', 'Templar active-market catalogue unavailable.');
  const html = await response.text();
  if (html.length > 1000000) throw new AppError('UNAVAILABLE', 'Templar catalogue exceeded expected size.');
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  const start = text.indexOf('Markets listed on app.templarfi.org');
  const end = text.indexOf('Deprecated markets', start);
  if (start < 0 || end <= start) throw new AppError('UNAVAILABLE', 'Templar catalogue format changed.');
  const ids = text.slice(start, end).match(/[a-z0-9]+(?:[._-][a-z0-9]+)*\.v1\.tmplr\.near/g) ?? [];
  if (!ids.length) throw new AppError('UNAVAILABLE', 'No active Templar markets could be verified.');
  return new Set(ids);
}
export async function verifyTemplarMarket(view: TemplarView, marketId: string, rpcUrl: string) {
  if (!(await activeTemplarMarkets()).has(marketId))
    throw new AppError('FORBIDDEN', 'Market is not currently offered by Templar.');
  const deployment = z
    .object({ version_key: z.string(), code_hash: z.string(), block_height: z.union([z.string(), z.number()]) })
    .parse(await view(REGISTRY, 'get_deployment', { account_id: marketId }));
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'templar-code',
      method: 'query',
      params: { request_type: 'view_account', finality: 'final', account_id: marketId },
    }),
    signal: AbortSignal.timeout(8000),
    redirect: 'manual',
  });
  if (!response.ok) throw new AppError('UNAVAILABLE', 'Templar code verification unavailable.');
  const account = z.object({ result: z.object({ code_hash: z.string() }) }).parse(await response.json());
  // Markets are upgraded in place, and most active ones run a build the registry never listed (checked
  // 2026-11-15: 21 of 22 on market contract 1.6.0), so the running code cannot be required to match a
  // listed version. What the registry does record is the versions Templar withdrew: refuse those.
  const withdrawn = await withdrawnVersions(view);
  if (withdrawn.has(account.result.code_hash))
    throw new AppError('FORBIDDEN', 'This market runs a contract version Templar has withdrawn.');
  const client = new TemplarClient(view, new Set([marketId]));
  const configuration = await client.configuration(marketId);
  return { deployment, configuration, client };
}

let withdrawnCache: ReturnType<typeof cached<Set<string>>> | null = null;

/** Code hashes of the versions Templar's registry marks Removed. */
function withdrawnVersions(view: TemplarView): Promise<Set<string>> {
  withdrawnCache ??= cached(async () => {
    const versions = z
      .array(z.string())
      .max(256)
      .parse(await view(REGISTRY, 'list_versions', {}));
    const listed = await Promise.all(
      versions.map(async (key) =>
        z
          // `availability` is "Removed", "Global", or { Stored: { code_len } }.
          .object({ code_hash: z.string(), availability: z.unknown() })
          .nullable()
          .catch(null)
          .parse(await view(REGISTRY, 'get_version', { version_key: key })),
      ),
    );
    return new Set(listed.flatMap((version) => (version?.availability === 'Removed' ? [version.code_hash] : [])));
  });
  return withdrawnCache();
}
