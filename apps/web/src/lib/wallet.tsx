import type { NearConnector } from '@hot-labs/near-connect';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useHealth } from './health.ts';

type Network = 'mainnet' | 'testnet';

interface WalletState {
  address: string | null;
  connecting: boolean;
  error: string | null;
}

interface Wallet extends WalletState {
  connect(): Promise<void>;
  disconnect(): void;
}

/** Remembers that a wallet was connected, so pages that never touch one don't load the connector. */
const CONNECTED_HINT = 'harbor.wallet.connected';
/** What the connector rejects with when the user closes the wallet picker. */
const USER_CANCELLED = 'User rejected';

const WalletContext = createContext<Wallet | null>(null);

/**
 * The connected NEAR account, through NEAR Connect. The user signs in their own wallet; Harbor
 * never sees or holds a key.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const network = useHealth().data?.network;
  const connector = useRef<Promise<NearConnector> | null>(null);
  const [state, setState] = useState<WalletState>({ address: null, connecting: false, error: null });

  const loadConnector = useCallback((forNetwork: Network) => {
    connector.current ??= createConnector(forNetwork);
    return connector.current;
  }, []);

  useEffect(() => {
    if (!network || !readHint()) return;
    let active = true;
    loadConnector(network)
      .then((loaded) => loaded.getConnectedWallet())
      .then(
        ({ accounts }) => {
          const address = accounts[0]?.accountId ?? null;
          if (active) setState((previous) => ({ ...previous, address }));
        },
        () => writeHint(false),
      );
    return () => {
      active = false;
    };
  }, [network, loadConnector]);

  const connect = useCallback(async () => {
    if (!network) {
      setState((previous) => ({ ...previous, error: 'Still reaching Harbor. Try again in a moment.' }));
      return;
    }
    setState((previous) => ({ ...previous, connecting: true, error: null }));
    try {
      const loaded = await loadConnector(network);
      await loaded.connect();
      const { accounts } = await loaded.getConnectedWallet();
      const address = accounts[0]?.accountId;
      if (!address) throw new Error('The wallet returned no account.');
      writeHint(true);
      setState({ address, connecting: false, error: null });
    } catch (caught) {
      const cancelled = caught instanceof Error && caught.message === USER_CANCELLED;
      setState({
        address: null,
        connecting: false,
        error: cancelled ? null : 'The wallet could not connect. Please try again.',
      });
    }
  }, [network, loadConnector]);

  const disconnect = useCallback(() => {
    writeHint(false);
    setState({ address: null, connecting: false, error: null });
    void connector.current?.then((loaded) => loaded.disconnect()).catch(() => undefined);
  }, []);

  const value = useMemo(() => ({ ...state, connect, disconnect }), [state, connect, disconnect]);
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

function readHint(): boolean {
  try {
    return localStorage.getItem(CONNECTED_HINT) === '1';
  } catch {
    return false;
  }
}

function writeHint(connected: boolean): void {
  try {
    if (connected) localStorage.setItem(CONNECTED_HINT, '1');
    else localStorage.removeItem(CONNECTED_HINT);
  } catch {
    // Without storage the wallet still connects; it just isn't restored on the next visit.
  }
}
