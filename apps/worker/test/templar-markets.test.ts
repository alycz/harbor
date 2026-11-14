import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.restoreAllMocks());
it('fails closed for malformed withdrawn-version metadata and retries a failed cache read', async () => {
  vi.resetModules();
  const { verifyTemplarMarket } = await import('../src/templar/markets.ts');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url).includes('docs.templarfi.org')
        ? new Response(
            '<h4>Markets listed on app.templarfi.org</h4><code>market.v1.tmplr.near</code><h4>Deprecated markets</h4>',
          )
        : Response.json({ result: { code_hash: 'code' } }),
    ),
  );
  let version: unknown = { code_hash: 'code', availability: 'UNRECOGNIZED' };
  const view = async (_account: string, method: string): Promise<unknown> => {
    if (method === 'get_deployment') return { version_key: 'v1', code_hash: 'code', block_height: '1' };
    if (method === 'list_versions') return ['v1'];
    if (method === 'get_version') return version;
    return { borrow_asset: { Nep141: 'usdc.near' }, collateral_asset: { Nep141: 'wrap.near' } };
  };
  await expect(verifyTemplarMarket(view, 'market.v1.tmplr.near', 'https://rpc.test')).rejects.toThrow();
  version = { code_hash: 'code', availability: 'Removed' };
  await expect(verifyTemplarMarket(view, 'market.v1.tmplr.near', 'https://rpc.test')).rejects.toThrow('withdrawn');
  vi.unstubAllGlobals();
});
