import { TemplarClient, type TemplarView } from '@harbor/adapters/templar/client';
import { AppError } from '@harbor/domain/errors';
import { z } from 'zod';

const REGISTRY = 'v1.tmplr.near';
/**
 * Official active-market catalogue, not an operator-maintained allowlist.
 * Registry membership alone is insufficient: retired markets remain fully functional.
 * Source: https://docs.templarfi.org/guide/addresses.html
 * Fail closed on catalogue changes/outages rather than treating every deployment as active.
 */
export async function activeTemplarMarkets(): Promise<Set<string>> {
  const response = await fetch('https://docs.templarfi.org/guide/addresses.html', {
    signal: AbortSignal.timeout(8000),
    redirect: 'error',
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
    redirect: 'error',
  });
  if (!response.ok) throw new AppError('UNAVAILABLE', 'Templar code verification unavailable.');
  const account = z.object({ result: z.object({ code_hash: z.string() }) }).parse(await response.json());
  if (account.result.code_hash !== deployment.code_hash)
    throw new AppError('FORBIDDEN', 'Market code no longer matches its registry deployment.');
  const client = new TemplarClient(view, new Set([marketId]));
  const configuration = await client.configuration(marketId);
  return { deployment, configuration, client };
}
