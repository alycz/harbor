import { Button } from '@harbor/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@harbor/ui/components/dropdown-menu';
import {
  type PanelImperativeHandle,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@harbor/ui/components/resizable';
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@harbor/ui/components/sheet';
import { Skeleton } from '@harbor/ui/components/skeleton';
import { Link, Outlet, useLocation } from '@tanstack/react-router';
import { Check, ChevronDown, LoaderCircle, Menu, Wallet } from 'lucide-react';
import { type ReactNode, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';

import './workspace-design.css';
import './workspace-research.css';
import './workspace-trade.css';
import './workspace-conversation.css';

import { useHealth } from '../lib/health.ts';
import { shortAddress, useWallet, WalletProvider } from '../lib/wallet.tsx';
import { AdjacentAssistant, AgentPanel } from './agent-panel.tsx';
import { HarborLogo } from './harbor-logo.tsx';
import { PolicyDrawer } from './policy-drawer.tsx';
import { useWorkspaceSession, WorkspaceSessionProvider } from './workspace-session.tsx';

const ROUTES = [
  { to: '/chat', label: 'Chat' },
  { to: '/research', label: 'Research' },
  { to: '/earn', label: 'Earn' },
  { to: '/trade', label: 'Trade' },
  { to: '/portfolio', label: 'Portfolio' },
] as const;

/** The workspace frame. Route pages render in its outlet; error and not-found pages pass `children`. */
export function AppShell({ children }: { children?: ReactNode }) {
  return (
    <WalletProvider>
      <WorkspaceSessionProvider>
        <WorkspaceShell>{children}</WorkspaceShell>
      </WorkspaceSessionProvider>
    </WalletProvider>
  );
}

function WorkspaceShell({ children }: { children: ReactNode }) {
  const { assistantOpen } = useWorkspaceSession();
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 1200px)').matches);
  const [assistantWidth, setAssistantWidth] = useState(380);
  const assistantRef = useRef<PanelImperativeHandle | null>(null);
  const workspaceScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1200px)');
    function updateDesktop() {
      setDesktop(media.matches);
    }
    media.addEventListener('change', updateDesktop);
    return () => media.removeEventListener('change', updateDesktop);
  }, []);
  const pathname = useLocation({ select: (location) => location.pathname });
  useLayoutEffect(() => {
    workspaceScrollRef.current?.scrollTo(0, 0);
  }, [pathname]);
  return (
    <div className="harbor-workspace flex h-svh min-w-0 flex-col overflow-hidden">
      <a
        href="#workspace"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-background focus:p-3"
      >
        Skip to workspace
      </a>
      <header className="sticky top-0 z-40 flex h-16 min-w-0 shrink-0 items-center gap-2 border-b bg-background px-3 sm:gap-3 sm:px-5 xl:gap-[30px] xl:px-7">
        <Link to="/research" className="flex shrink-0 items-center gap-2.5" aria-label="Harbor home">
          <HarborLogo />
        </Link>
        <nav aria-label="Primary" className="hidden h-full items-center gap-6 md:flex">
          {ROUTES.map((route) => (
            <Link
              key={route.to}
              to={route.to}
              className="workspace-primary-link transition-colors hover:text-foreground"
              aria-current={isActiveGroup(pathname, route.to) ? 'page' : undefined}
            >
              {route.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2 [&_button]:h-11! [&_button]:min-w-11!">
          <div className="hidden lg:block">
            <NetworkStatus />
          </div>
          <PolicyDrawer />
          <WalletButton />
          <Sheet>
            <SheetTrigger
              render={<Button variant="ghost" size="icon" aria-label="Open navigation" className="md:hidden" />}
            >
              <Menu />
            </SheetTrigger>
            <SheetContent side="left" className="w-full sm:max-w-80">
              <SheetHeader>
                <SheetTitle>Workspace</SheetTitle>
              </SheetHeader>
              <nav className="flex flex-col border-t border-line mx-4" aria-label="Workspace navigation">
                {ROUTES.map((route) => (
                  <SheetClose
                    nativeButton={false}
                    key={route.to}
                    render={
                      <Link
                        to={route.to}
                        className="border-b border-line px-3 py-3.5 text-xs font-medium tracking-[0.6px] uppercase hover:text-primary aria-[current=page]:text-primary"
                      />
                    }
                  >
                    {route.label}
                  </SheetClose>
                ))}
                <SheetClose
                  nativeButton={false}
                  render={
                    <Link
                      to="/settings/policy"
                      className="border-b border-line px-3 py-3.5 text-xs font-medium tracking-[0.6px] uppercase hover:text-primary aria-[current=page]:text-primary"
                    />
                  }
                >
                  Policy
                </SheetClose>
              </nav>
              <div className="px-7 pt-4">
                <NetworkStatus />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>
      <div className="workspace-runtime-bar">
        <span>
          <strong>● NEAR workspace</strong>
          <span className="ml-3">Cross-chain research · you sign every action</span>
        </span>
        <span>Research observations and execution quotes keep their own network and timestamps.</span>
      </div>
      <ResizablePanelGroup
        orientation="horizontal"
        className="min-h-0 flex-1"
        style={{ height: 'calc(100svh - 6.5rem)' }}
      >
        <ResizablePanel id="workspace-panel" minSize={desktop && assistantOpen ? 600 : 0}>
          <div id="workspace-scroll" ref={workspaceScrollRef} className="relative h-full overflow-y-auto">
            <WorkspaceContent>{children}</WorkspaceContent>
          </div>
        </ResizablePanel>
        {desktop && assistantOpen ? (
          <>
            <ResizableHandle
              withHandle
              aria-label="Resize assistant"
              aria-valuetext={`${Math.round(assistantWidth)} pixels`}
              onDoubleClick={() => assistantRef.current?.resize(380)}
            />
            <ResizablePanel
              id="assistant-panel"
              panelRef={assistantRef}
              defaultSize={assistantWidth}
              minSize={320}
              maxSize={560}
              groupResizeBehavior="preserve-pixel-size"
              onResize={(size) => setAssistantWidth(size.inPixels)}
            >
              <AdjacentAssistant />
            </ResizablePanel>
          </>
        ) : null}
      </ResizablePanelGroup>
      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-background md:hidden"
      >
        {ROUTES.map((route) => (
          <Link
            key={route.to}
            to={route.to}
            className={`flex min-h-14 min-w-0 items-center justify-center border-t-2 text-[10px] font-medium tracking-[0.4px] uppercase sm:text-[11px] ${isActiveGroup(pathname, route.to) ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}
            aria-current={isActiveGroup(pathname, route.to) ? 'page' : undefined}
          >
            {route.label}
          </Link>
        ))}
      </nav>
      {pathname !== '/chat' && !assistantOpen ? (
        <div className="fixed right-4 bottom-20 z-40 xl:right-7 md:bottom-6">
          <AgentPanel desktop={desktop} />
        </div>
      ) : null}
      {!desktop && assistantOpen ? <AgentPanel desktop={false} /> : null}
    </div>
  );
}

function WorkspaceContent({ children }: { children: ReactNode }) {
  const chatPage = useLocation({ select: (location) => location.pathname === '/chat' });
  return (
    <main
      id="workspace"
      className={`mx-auto w-full min-w-0 max-w-[1920px] px-4 pt-5 sm:px-6 sm:pt-6 lg:px-7 lg:pt-7 ${chatPage ? 'flex h-full flex-col overflow-hidden pb-20 md:pb-6' : 'flex-1 pb-24 md:pb-8'}`}
    >
      <Suspense
        fallback={
          <div role="status" className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
            Loading workspace…
          </div>
        }
      >
        {children ?? <Outlet />}
      </Suspense>
    </main>
  );
}

const STATUS_TAG =
  'inline-flex h-8 items-center gap-2 border border-line px-2.5 text-[11px] font-medium tracking-[0.6px] whitespace-nowrap uppercase';

function NetworkStatus() {
  const health = useHealth();
  if (health.isPending) return <Skeleton className="h-6 w-24" />;
  if (health.isError || !health.data.ok) return <span className={STATUS_TAG}>Connection unavailable</span>;
  return (
    <span
      className={STATUS_TAG}
      title={health.data.executionEnabled ? undefined : 'Swaps can be reviewed and approved, but nothing is submitted.'}
    >
      <span aria-hidden="true" className={health.data.executionEnabled ? 'text-success' : 'text-primary'}>
        ●
      </span>
      {health.data.network === 'mainnet' ? 'Mainnet' : 'Testnet'}
      <span className="text-muted-foreground">{health.data.executionEnabled ? 'Execution on' : 'Execution off'}</span>
    </span>
  );
}

function isActiveGroup(pathname: string, route: string) {
  if (route === '/portfolio') return pathname.startsWith('/portfolio') || pathname.startsWith('/plans');
  return pathname.startsWith(route);
}

function WalletButton() {
  const { address, connecting, connect, disconnect, error } = useWallet();
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
  }

  return (
    <div className="relative">
      {address ? (
        <DropdownMenu
          onOpenChange={(open) => {
            if (open) setCopyStatus('idle');
          }}
        >
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                disabled={connecting}
                aria-label={`Manage wallet ${shortAddress(address)}`}
                title={address}
              />
            }
          >
            <Wallet className="sm:hidden" />
            <span className="hidden font-mono sm:inline">{shortAddress(address)}</span>
            <ChevronDown className="hidden size-3 sm:block" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={8}
            aria-label="Wallet account"
            className="w-56 border border-line p-1.5"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="px-3 pt-2 pb-1.5 font-normal">
                Account
                <span className="mt-1 block font-mono text-[11px] sm:hidden">{shortAddress(address)}</span>
              </DropdownMenuLabel>
              <DropdownMenuItem closeOnClick={false} onClick={copyAddress} className="min-h-11 px-3 py-2 font-normal">
                {copyStatus === 'copied' ? 'Address copied' : 'Copy address'}
                {copyStatus === 'copied' ? <Check className="ml-auto size-4 text-success" aria-hidden="true" /> : null}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={disconnect} className="min-h-11 px-3 py-2 font-normal">
              Disconnect
            </DropdownMenuItem>
            {copyStatus === 'failed' ? (
              <p role="alert" className="px-3 py-2 text-xs leading-relaxed text-destructive">
                Couldn’t copy the address. Please try again.
              </p>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          onClick={connect}
          disabled={connecting}
          aria-label={connecting ? 'Connecting wallet' : 'Connect wallet'}
          aria-haspopup="dialog"
        >
          {connecting ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Wallet />}
          <span className="hidden sm:inline">{connecting ? 'Connecting…' : 'Connect wallet'}</span>
        </Button>
      )}
      {error ? (
        <p
          role="alert"
          className="absolute top-full right-0 z-50 mt-3 w-72 max-w-[calc(100vw-2rem)] border border-destructive border-l-2 bg-popover p-3 text-xs leading-relaxed text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
