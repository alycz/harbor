import type { NearConnector } from '@hot-labs/near-connect';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { call, ExecutionRequestError } from './execution.ts';
import { useHealth } from './health.ts';

type Network = 'mainnet' | 'testnet';

interface WalletState {
  /** The account of the verified session, not merely a connected wallet. */
  address: string | null;
  connecting: boolean;
  /** True until Harbor has checked for a returning user's session, so pages can wait rather than flash "connect". */
  restoring: boolean;
  error: string | null;
}

/** A transaction for the wallet to sign and send: one receiver, NEAR Connect's plain action shapes. */
export interface WalletTransaction {
  receiverId: string;
  actions: {
    type: 'FunctionCall';
    params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string };
  }[];
}

interface Wallet extends WalletState {
  connect(): Promise<void>;
  disconnect(): void;
  /** Asks the signed-in account's wallet to sign a NEP-413 message the server prepared. */
  signMessage(input: { message: string; recipient: string; nonce: string }): Promise<{
    publicKey: string;
    signature: string;
  }>;
  /** Asks the signed-in account's wallet to sign and send one transaction; resolves to its hash. */
  sendTransaction(transaction: WalletTransaction): Promise<string>;
}

interface Session {
  accountId: string;
  network: Network;
  expiresAt: string;
}

interface Challenge {
  nonce: string;
  message: string;
  recipient: string;
}

/** What the connector rejects with when the user closes the wallet picker. */
const USER_CANCELLED = 'User rejected';

const WalletContext = createContext<Wallet | null>(null);

/**
 * Sign-in with a NEAR wallet: connect through NEAR Connect, sign a one-time NEP-413 message, and the
 * Worker verifies it and opens a session. The user signs in their own wallet; Harbor never sees or
 * holds a key, and signing this message cannot move funds.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const network = useHealth().data?.network;
  const connector = useRef<Promise<NearConnector> | null>(null);
  const [state, setState] = useState<WalletState>({ address: null, connecting: false, restoring: true, error: null });

  const loadConnector = useCallback((forNetwork: Network) => {
    connector.current ??= createConnector(forNetwork);
    return connector.current;
  }, []);

  // A returning user keeps their session without loading any wallet code.
  useEffect(() => {
    let active = true;
    call<{ session: Session | null }>('/api/auth/session').then(
      ({ session }) => {
        if (active) setState((previous) => ({ ...previous, address: session?.accountId ?? null, restoring: false }));
      },
      () => {
        if (active) setState((previous) => ({ ...previous, restoring: false }));
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const connect = useCallback(async () => {
    if (!network) {
      setState((previous) => ({ ...previous, error: 'Still reaching Harbor. Try again in a moment.' }));
      return;
    }
    setState((previous) => ({ ...previous, connecting: true, error: null }));
    try {
      const loaded = await loadConnector(network);
      const wallet = await loaded.connect();
      const { accounts } = await loaded.getConnectedWallet();
      const accountId = accounts[0]?.accountId;
      if (!accountId) throw new Error('The wallet returned no account.');
      const challenge = await call<Challenge>('/api/auth/challenge', { method: 'POST', body: { accountId } });
      const signed = await wallet.signMessage({
        message: challenge.message,
        recipient: challenge.recipient,
        nonce: Uint8Array.from(atob(challenge.nonce), (character) => character.charCodeAt(0)),
        network,
        signerId: accountId,
      });
      const { session } = await call<{ session: Session }>('/api/auth/verify', {
        method: 'POST',
        body: {
          accountId: signed.accountId,
          publicKey: signed.publicKey,
          signature: signed.signature,
          nonce: challenge.nonce,
        },
      });
      setState({ address: session.accountId, connecting: false, restoring: false, error: null });
    } catch (caught) {
      setState({ address: null, connecting: false, restoring: false, error: signInProblem(caught) });
    }
  }, [network, loadConnector]);

  const disconnect = useCallback(() => {
    setState({ address: null, connecting: false, restoring: false, error: null });
    void call('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    void connector.current?.then((loaded) => loaded.disconnect()).catch(() => undefined);
  }, []);

  /** The wallet for the signed-in account, reconnecting after a reload; refuses a different account. */
  const sessionWallet = useCallback(async () => {
    const account = state.address;
    if (!account || !network) throw new WalletProblem('Connect your wallet first.');
    const loaded = await loadConnector(network);
    const wallet = await loaded.wallet().catch(() => loaded.connect());
    const accounts = await wallet.getAccounts();
    if (!accounts.some((entry) => entry.accountId === account)) {
      throw new WalletProblem(`Switch your wallet to ${account}, the account you signed in with.`);
    }
    return { wallet, account };
  }, [state.address, network, loadConnector]);

  const signMessage = useCallback(
    async (input: { message: string; recipient: string; nonce: string }) => {
      const { wallet, account } = await sessionWallet();
      const signed = await wallet.signMessage({
        message: input.message,
        recipient: input.recipient,
        nonce: Uint8Array.from(atob(input.nonce), (character) => character.charCodeAt(0)),
        network: network ?? 'mainnet',
        signerId: account,
      });
      if (signed.accountId !== account) throw new WalletProblem('The wallet signed for a different account.');
      return { publicKey: signed.publicKey, signature: signed.signature };
    },
    [sessionWallet, network],
  );

  const sendTransaction = useCallback(
    async (transaction: WalletTransaction) => {
      const { wallet, account } = await sessionWallet();
      const outcome = await wallet.signAndSendTransaction({
        network: network ?? 'mainnet',
        signerId: account,
        receiverId: transaction.receiverId,
        actions: transaction.actions,
      });
      const hash = outcome?.transaction?.hash ?? outcome?.transaction_outcome?.id;
      if (typeof hash !== 'string' || hash.length === 0) {
        throw new WalletProblem('The wallet did not return a transaction hash. Check your wallet activity.');
      }
      return hash;
    },
    [sessionWallet, network],
  );

  const value = useMemo(
    () => ({ ...state, connect, disconnect, signMessage, sendTransaction }),
    [state, connect, disconnect, signMessage, sendTransaction],
  );
  return <WalletContext value={value}>{children}</WalletContext>;
}

export function useWallet(): Wallet {
  const wallet = useContext(WalletContext);
  if (!wallet) throw new Error('useWallet needs a WalletProvider.');
  return wallet;
}

/** The start and end of a long account ID; short named accounts show in full. */
export function shortAddress(address: string): string {
  return address.length <= 20 ? address : `${address.slice(0, 8)}…${address.slice(-6)}`;
}

async function createConnector(network: Network): Promise<NearConnector> {
  const { NearConnector } = await import('@hot-labs/near-connect');
  // Sign-in needs a signed message, so wallets that cannot sign one are not offered.
  return new NearConnector({
    network,
    features: { signMessage: true, ...(network === 'testnet' ? { testnet: true } : {}) },
  });
}

/** A wallet problem the user can act on; its message is safe to show as is. */
class WalletProblem extends Error {
  override name = 'WalletProblem';
}

/** What to show for a failed wallet step, or null when the user simply closed the wallet. */
export function walletProblem(caught: unknown): string | null {
  if (caught instanceof WalletProblem || caught instanceof ExecutionRequestError) return caught.message;
  if (caught instanceof Error && /reject|cancel|closed/i.test(caught.message)) return null;
  return 'The wallet did not complete this. Please try again.';
}

function signInProblem(caught: unknown): string | null {
  if (caught instanceof ExecutionRequestError) return caught.message;
  if (caught instanceof Error && caught.message === USER_CANCELLED) return null;
  return 'Sign-in did not complete. Please try again.';
}
