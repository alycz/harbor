import { z } from 'zod';

/** Rhea's official lending SDK: https://github.com/rhea-finance/lending-sdk-golang */
export const RHEA_LENDING_CONTRACT = 'contract.main.burrow.near';
const Account = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
const Amount = z.string().regex(/^(0|[1-9]\d{0,38})$/);
const Asset = z.object({
  token_id: Account,
  supplied: z.object({ balance: Amount }),
  supply_apr: z.string().regex(/^\d+(\.\d+)?$/),
  config: z.object({
    can_deposit: z.boolean(),
    can_withdraw: z.boolean(),
    extra_decimals: z.number().int().min(0).max(24),
  }),
});
const Storage = z.object({ total: Amount, available: Amount }).nullable();
const StorageBounds = z.object({ min: Amount });
const U128_MAX = (1n << 128n) - 1n;
const SUPPLY_GAS = '100000000000000';
const REGISTRATION_GAS = '30000000000000';

/** A wallet-signable NEAR call, never a submitted transaction. No keys are accepted by this adapter. */
export interface RheaTransaction {
  receiverId: string;
  actions: Array<{
    type: 'FunctionCall';
    params: { methodName: string; args: Record<string, string>; gas: string; deposit: string };
  }>;
}

export interface RheaSupplyPlan {
  adapter: 'rhea-lending';
  network: 'near:mainnet';
  signerId: string;
  tokenId: string;
  amount: string;
  transaction: RheaTransaction;
  preparedAt: number;
  expiresAt: number;
}

/** One Rhea lending market as the contract reports it now. */
export interface RheaMarket {
  tokenId: string;
  /** Supply APR in percent, as the contract computes it; farm rewards are not included. */
  supplyAprPct: number;
  /** Total supplied in the contract's internal units: token decimals plus `extraDecimals`. */
  suppliedRaw: string;
  extraDecimals: number;
  canDeposit: boolean;
  canWithdraw: boolean;
}

/** The account has no Rhea storage yet: it must register, one wallet transaction, before supplying. */
export class RheaRegistrationRequired extends Error {
  constructor() {
    super('Register with Rhea before supplying');
    this.name = 'RheaRegistrationRequired';
  }
}

/** Read-only NEAR RPC plus deterministic supply and registration transaction preparation.
 * The caller must bind a supply plan to user approval and enforce Harbor execution gates.
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
      // Workers reject redirect: 'error'; a redirect comes back as a non-2xx response and is refused below.
      redirect: 'manual',
      signal: AbortSignal.timeout(8_000),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'harbor-rhea',
        method: 'query',
        params: {
          request_type: 'call_function',
          finality: 'final',
          account_id: accountId,
          method_name: methodName,
          args_base64: btoa(JSON.stringify(args)),
        },
      }),
    });
    if (!response.ok) throw new Error('Rhea chain read failed');
    const text = await response.text();
    if (text.length > 262_144) throw new Error('Rhea chain response too large');
    const payload = z
      .object({ result: z.object({ result: z.array(z.number().int().min(0).max(255)).max(131_072) }) })
      .parse(JSON.parse(text));
    return JSON.parse(new TextDecoder().decode(new Uint8Array(payload.result.result))) as unknown;
  }
  async function asset(tokenId: string) {
    Account.parse(tokenId);
    // The contract's view takes `token_id` (Burrowland `get_asset`); `asset_id` makes it panic.
    const parsed = Asset.parse(await view(RHEA_LENDING_CONTRACT, 'get_asset', { token_id: tokenId }));
    if (parsed.token_id !== tokenId) throw new Error('Rhea asset identity mismatch');
    return parsed;
  }
  async function storage(accountId: string) {
    return Storage.parse(await view(RHEA_LENDING_CONTRACT, 'storage_balance_of', { account_id: accountId }));
  }
  return {
    /** The market's raw contract record, after its identity is checked. */
    asset,
    async market(tokenId: string): Promise<RheaMarket> {
      const raw = await asset(tokenId);
      return {
        tokenId: raw.token_id,
        supplyAprPct: Number(raw.supply_apr) * 100,
        suppliedRaw: raw.supplied.balance,
        extraDecimals: raw.config.extra_decimals,
        canDeposit: raw.config.can_deposit,
        canWithdraw: raw.config.can_withdraw,
      };
    },
    /** Whether the account can supply now, and if not, the one registration transaction it must sign first. */
    async registration(accountId: string): Promise<{ registered: boolean; transaction: RheaTransaction | null }> {
      Account.parse(accountId);
      const [current, bounds] = await Promise.all([
        storage(accountId),
        view(RHEA_LENDING_CONTRACT, 'storage_balance_bounds', {}).then((raw) => StorageBounds.parse(raw)),
      ]);
      if (current && BigInt(current.total) > 0n) return { registered: true, transaction: null };
      return {
        registered: false,
        transaction: {
          receiverId: RHEA_LENDING_CONTRACT,
          actions: [
            {
              type: 'FunctionCall',
              params: {
                methodName: 'storage_deposit',
                args: { account_id: accountId },
                gas: REGISTRATION_GAS,
                // Exactly the contract's minimum: registration only, nothing extra is held.
                deposit: bounds.min,
              },
            },
          ],
        },
      };
    },
    async prepareSupply(input: {
      network: 'near:mainnet';
      accountId: string;
      tokenId: string;
      amount: bigint;
    }): Promise<RheaSupplyPlan> {
      if (input.network !== 'near:mainnet') throw new Error('Rhea supply is mainnet-only');
      const accountId = Account.parse(input.accountId);
      const tokenId = Account.parse(input.tokenId);
      if (input.amount <= 0n || input.amount > U128_MAX) throw new Error('Invalid Rhea supply amount');
      // On-chain config and balance must be checked, not inferred from model output or ticker symbols.
      // Official view methods: common/lending/view.go in the Rhea SDK.
      const [market, rawBalance, current] = await Promise.all([
        asset(tokenId),
        view(tokenId, 'ft_balance_of', { account_id: accountId }),
        storage(accountId),
      ]);
      if (!market.config.can_deposit) throw new Error('Rhea deposits unavailable for this asset');
      if (BigInt(Amount.parse(rawBalance)) < input.amount) throw new Error('Insufficient token balance');
      if (!current || BigInt(current.total) === 0n) throw new RheaRegistrationRequired();
      const now = Date.now();
      return {
        adapter: 'rhea-lending',
        network: 'near:mainnet',
        signerId: accountId,
        tokenId,
        amount: input.amount.toString(),
        preparedAt: now,
        expiresAt: now + 60_000,
        transaction: {
          receiverId: tokenId,
          actions: [
            {
              type: 'FunctionCall',
              params: {
                // SDK BuildDeposit uses empty msg: supply only, never opt the user into collateral.
                // https://github.com/rhea-finance/lending-sdk-golang/blob/main/common/lending/write.go
                methodName: 'ft_transfer_call',
                args: { receiver_id: RHEA_LENDING_CONTRACT, amount: input.amount.toString(), msg: '' },
                gas: SUPPLY_GAS,
                deposit: '1',
              },
            },
          ],
        },
      };
    },
  };
}
