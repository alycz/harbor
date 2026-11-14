import { z } from 'zod';

/** Rhea's official lending SDK: https://github.com/rhea-finance/lending-sdk-golang */
export const RHEA_LENDING_CONTRACT = 'contract.main.burrow.near';
const Account = z.string().min(2).max(64).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
const Amount = z.string().regex(/^(0|[1-9]\d{0,38})$/);
const Asset = z.object({
  token_id: Account,
  config: z.object({ can_deposit: z.boolean() }),
});
const Storage = z.object({ total: Amount, available: Amount }).nullable();
const U128_MAX = (1n << 128n) - 1n;

export interface RheaSupplyPlan {
  adapter: 'rhea-lending';
  network: 'near:mainnet';
  signerId: string;
  tokenId: string;
  amount: string;
  /** A wallet-signable call, not a submitted transaction. No keys are accepted by this adapter. */
  transaction: {
    receiverId: string;
    actions: Array<{
      type: 'FunctionCall';
      params: { methodName: string; args: Record<string, string>; gas: string; deposit: string };
    }>;
  };
  preparedAt: number;
  expiresAt: number;
}

/** Read-only NEAR RPC plus deterministic, non-collateral supply transaction preparation.
 * The caller must bind this exact plan to user approval and enforce Harbor execution gates.
 * Never treat preparation or wallet submission as proof of settlement.
 */
export function createRheaLending(rpcUrl: string, fetcher: typeof fetch = fetch) {
  const endpoint = new URL(rpcUrl);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
    throw new Error('Rhea requires a trusted HTTPS NEAR mainnet RPC endpoint');
  }
  async function view(accountId: string, methodName: string, args: Record<string, string>) {
    Account.parse(accountId);
    const response = await fetcher(endpoint.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
      body: JSON.stringify({ jsonrpc: '2.0', id: 'harbor-rhea', method: 'query', params: {
        request_type: 'call_function', finality: 'final', account_id: accountId,
        method_name: methodName, args_base64: btoa(JSON.stringify(args)),
      } }),
    });
    if (!response.ok) throw new Error('Rhea chain read failed');
    const text = await response.text();
    if (text.length > 262_144) throw new Error('Rhea chain response too large');
    const payload = z.object({ result: z.object({ result: z.array(z.number().int().min(0).max(255)).max(131_072) }) }).parse(JSON.parse(text));
    return JSON.parse(new TextDecoder().decode(new Uint8Array(payload.result.result))) as unknown;
  }
  return {
    async asset(tokenId: string) {
      Account.parse(tokenId);
      const asset = Asset.parse(await view(RHEA_LENDING_CONTRACT, 'get_asset', { asset_id: tokenId }));
      if (asset.token_id !== tokenId) throw new Error('Rhea asset identity mismatch');
      return asset;
    },
    async prepareSupply(input: { network: 'near:mainnet'; accountId: string; tokenId: string; amount: bigint }): Promise<RheaSupplyPlan> {
      if (input.network !== 'near:mainnet') throw new Error('Rhea supply is mainnet-only');
      const accountId = Account.parse(input.accountId);
      const tokenId = Account.parse(input.tokenId);
      if (input.amount <= 0n || input.amount > U128_MAX) throw new Error('Invalid Rhea supply amount');
      // On-chain config and balance must be checked, not inferred from model output or ticker symbols.
      // Official view methods: common/lending/view.go in the Rhea SDK.
      const [rawAsset, rawBalance, rawStorage] = await Promise.all([
        view(RHEA_LENDING_CONTRACT, 'get_asset', { asset_id: tokenId }),
        view(tokenId, 'ft_balance_of', { account_id: accountId }),
        view(RHEA_LENDING_CONTRACT, 'storage_balance_of', { account_id: accountId }),
      ]);
      const asset = Asset.parse(rawAsset);
      if (asset.token_id !== tokenId || !asset.config.can_deposit) throw new Error('Rhea deposits unavailable for this asset');
      if (BigInt(Amount.parse(rawBalance)) < input.amount) throw new Error('Insufficient token balance');
      const storage = Storage.parse(rawStorage);
      if (!storage || BigInt(storage.total) === 0n) throw new Error('Register storage with Rhea before supplying');
      const now = Date.now();
      return {
        adapter: 'rhea-lending', network: 'near:mainnet', signerId: accountId,
        tokenId, amount: input.amount.toString(), preparedAt: now, expiresAt: now + 60_000,
        transaction: {
          receiverId: tokenId,
          actions: [{ type: 'FunctionCall', params: {
            // SDK BuildDeposit uses empty msg: supply only, never opt the user into collateral.
            // https://github.com/rhea-finance/lending-sdk-golang/blob/main/common/lending/write.go
            methodName: 'ft_transfer_call',
            args: { receiver_id: RHEA_LENDING_CONTRACT, amount: input.amount.toString(), msg: '' },
            gas: '100000000000000', deposit: '1',
          } }],
        },
      };
    },
  };
}
