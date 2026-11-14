import { describe, expect, it } from 'vitest';
import { checkKey, checkScope } from '../src/scope.ts';

const quote = JSON.stringify({ dry: false, refundTo: 'owner.near', deadline: '2099-01-01T00:00:00Z' });
const request = {
  network: 'mainnet',
  signerId: 'agent.near',
  receiverId: 'vault.near',
  methodName: 'execute',
  gas: '100000000000000',
  deposit: '0',
  args: { owner: 'owner.near', quote, signature: 'fixture-not-real' },
};
describe('bounded signer scope', () => {
  it('accepts only exact execute request', () =>
    expect(checkScope(request, 'agent.near', 'vault.near')).toEqual(request));
  it.each([
    { deposit: '1' },
    { methodName: 'transfer' },
    { receiverId: 'evil.near' },
    { signerId: 'owner.near' },
    { network: 'testnet' },
    { gas: '300000000000000' },
    { extra: 'injected' },
  ])('rejects scope expansion %j', (patch) =>
    expect(() => checkScope({ ...request, ...patch }, 'agent.near', 'vault.near')).toThrow(),
  );
  it('rejects expired or non-owner quote', () =>
    expect(() =>
      checkScope(
        {
          ...request,
          args: {
            ...request.args,
            quote: JSON.stringify({ dry: false, refundTo: 'evil.near', deadline: '2000-01-01' }),
          },
        },
        'agent.near',
        'vault.near',
      ),
    ).toThrow());
  it('accepts finite allowance execute key', () =>
    expect(() =>
      checkKey(
        { FunctionCall: { receiver_id: 'vault.near', method_names: ['execute'], allowance: '10' } },
        'vault.near',
      ),
    ).not.toThrow());
  it.each([
    'FullAccess',
    { FunctionCall: { receiver_id: 'vault.near', method_names: [], allowance: '10' } },
    { FunctionCall: { receiver_id: 'vault.near', method_names: ['execute', 'withdraw'], allowance: '10' } },
    { FunctionCall: { receiver_id: 'evil.near', method_names: ['execute'], allowance: '10' } },
    { FunctionCall: { receiver_id: 'vault.near', method_names: ['execute'], allowance: null } },
  ])('rejects broad key %j', (permission) => expect(() => checkKey(permission, 'vault.near')).toThrow());
});
