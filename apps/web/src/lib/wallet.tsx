import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

interface WalletState {
  address: string | null;
  connecting: boolean;
  error: string | null;
}

interface Wallet extends WalletState {
  connect(): Promise<void>;
  disconnect(): void;
}

const WalletContext = createContext<Wallet | null>(null);

/**
 * The connected account, if any. The user signs in their own wallet; Harbor never holds a key.
 * No wallet connector is wired yet, so connecting explains that instead of pretending.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>({ address: null, connecting: false, error: null });

  const connect = useCallback(async () => {
    setState((previous) => ({ ...previous, error: 'No wallet connector is configured in this build yet.' }));
  }, []);

  const disconnect = useCallback(() => {
    setState({ address: null, connecting: false, error: null });
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
