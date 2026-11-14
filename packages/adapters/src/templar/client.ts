import { z } from 'zod';

const Account = z.string().min(2).max(64).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
const Amount = z.string().regex(/^[1-9][0-9]*$/).refine((value) => BigInt(value) < 2n ** 128n);
const Asset = z.union([
  z.object({ Nep141: Account }),
  z.object({ Nep245: z.object({ contract_id: Account, token_id: z.string().min(1) }) }),
]);
const Configuration = z.object({ borrow_asset: Asset, collateral_asset: Asset }).passthrough();

export interface TemplarTransaction {
  receiverId: string;
  actions: { type: 'FunctionCall'; params: {
    methodName: string; args: Record<string, unknown>; gas: string; deposit: string;
  } }[];
}
export type TemplarView = (accountId: string, methodName: string, args: Record<string, unknown>) => Promise<unknown>;

/**
 * Real Templar NEAR contract calls; preparation only, NEVER signs or submits.
 * Inject Harbor's finalized NEAR RPC reader and a registry-verified market allowlist.
 * Callers must bind these transactions to their policy/approval and honor write-adapter gates.
 * Contract references:
 * https://docs.templarfi.org/guide/contract/market/borrow.html
 * https://github.com/Templar-Protocol/contracts/blob/dev/common/src/asset.rs
 */
export class TemplarClient {
  constructor(private readonly view: TemplarView, private readonly allowedMarkets: ReadonlySet<string>) {}

  async configuration(marketId: string) {
    this.market(marketId);
    return Configuration.parse(await this.view(marketId, 'get_configuration', {}));
  }

  /** Registration is a separate transaction. Confirm it before submitting the next transaction. */
  async registration(marketId: string, accountId: string): Promise<TemplarTransaction | null> {
    this.market(marketId);
    Account.parse(accountId);
    const existing = await this.view(marketId, 'storage_balance_of', { account_id: accountId });
    if (existing !== null) {
      z.object({ total: z.string().regex(/^[0-9]+$/), available: z.string().regex(/^[0-9]+$/) }).parse(existing);
      return null;
    }
    const bounds = z.object({ min: Amount }).parse(await this.view(marketId, 'storage_balance_bounds', {}));
    return call(marketId, 'storage_deposit', { account_id: accountId, registration_only: true }, bounds.min, '10000000000000');
  }

  async collateralize(marketId: string, amountAtomic: string): Promise<TemplarTransaction> {
    const config = await this.configuration(marketId);
    return transfer(config.collateral_asset, marketId, Amount.parse(amountAtomic), 'Collateralize');
  }

  /** Requires an already-collateralized position. The market enforces oracle/LTV/liquidity limits. */
  async borrow(marketId: string, amountAtomic: string): Promise<TemplarTransaction> {
    await this.configuration(marketId);
    return call(marketId, 'borrow', { amount: Amount.parse(amountAtomic) });
  }

  async repay(marketId: string, amountAtomic: string): Promise<TemplarTransaction> {
    const config = await this.configuration(marketId);
    return transfer(config.borrow_asset, marketId, Amount.parse(amountAtomic), 'Repay');
  }

  async withdrawCollateral(marketId: string, amountAtomic: string): Promise<TemplarTransaction> {
    await this.configuration(marketId);
    return call(marketId, 'withdraw_collateral', { amount: Amount.parse(amountAtomic) });
  }

  private market(marketId: string) {
    Account.parse(marketId);
    if (!this.allowedMarkets.has(marketId)) throw new Error('Templar market is not in the verified market registry.');
  }
}

function call(receiverId: string, methodName: string, args: Record<string, unknown>, deposit = '0', gas = '100000000000000'): TemplarTransaction {
  return { receiverId, actions: [{ type: 'FunctionCall', params: { methodName, args, gas, deposit } }] };
}

function transfer(asset: z.infer<typeof Asset>, marketId: string, amount: string, operation: 'Collateralize' | 'Repay'): TemplarTransaction {
  const args = { receiver_id: marketId, amount, msg: JSON.stringify(operation) };
  if ('Nep141' in asset) return call(asset.Nep141, 'ft_transfer_call', args, '1');
  return call(asset.Nep245.contract_id, 'mt_transfer_call', { ...args, token_id: asset.Nep245.token_id }, '1', '150000000000000');
}
