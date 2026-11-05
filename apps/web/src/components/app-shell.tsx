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
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '@harbor/ui/components/sheet';
import { Link, Outlet, useLocation } from '@tanstack/react-router';
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  Copy,
  LoaderCircle,
  LogOut,
  Menu,
  MessageCircle,
  PiggyBank,
  ShieldCheck,
  Telescope,
  Wallet,
  WalletCards,
} from 'lucide-react';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { type ReactNode, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';

import '../styles/workspace.css';

import { useHealth } from '../lib/health.ts';
import { shortAddress, useWallet, WalletProvider } from '../lib/wallet.tsx';
import { AdjacentAssistant, AgentPanel } from './agent-panel.tsx';
import { HarborLogo, HarborMark } from './harbor-logo.tsx';
import { PageSkeleton } from './skeletons.tsx';
import { useAppSurface } from './surface.ts';
import { AccountDot } from './workspace.tsx';
import { useWorkspaceSession, WorkspaceSessionProvider } from './workspace-session.tsx';

const ROUTES = [
  { to: '/chat', label: 'Chat', icon: MessageCircle },
  { to: '/research', label: 'Research', icon: Telescope },
  { to: '/earn', label: 'Earn', icon: PiggyBank },
  { to: '/trade', label: 'Trade', icon: ArrowLeftRight },
  { to: '/portfolio', label: 'Portfolio', icon: WalletCards },
] as const;

const SETTINGS = [{ to: '/settings/policy', label: 'Policy', icon: ShieldCheck }] as const;

type NavItem = (typeof ROUTES)[number] | (typeof SETTINGS)[number];

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
  useAppSurface();
  const { assistantOpen, setAssistantOpen } = useWorkspaceSession();
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
  // ⌘K / Ctrl+K opens and closes Ask Harbor beside any page; on the chat page it focuses the composer.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey) || event.altKey) return;
      event.preventDefault();
      if (pathname === '/chat') document.querySelector<HTMLTextAreaElement>('#workspace textarea')?.focus();
      else setAssistantOpen(!assistantOpen);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [pathname, assistantOpen, setAssistantOpen]);
  useLayoutEffect(() => {
    workspaceScrollRef.current?.scrollTo(0, 0);
  }, [pathname]);
  return (
    <div className="ws-shell harbor-workspace flex h-svh min-w-0 overflow-hidden">
      <a
        href="#workspace"
        className="fixed top-3 left-3 z-50 -translate-y-24 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-transform focus:translate-y-0"
      >
        Skip to workspace
      </a>

      <aside
        aria-label="Sidebar"
        className="hidden w-(--ws-sidebar) shrink-0 flex-col border-r border-border bg-background lg:flex"
      >
        <div className="flex h-(--ws-header) shrink-0 items-center border-b border-border px-5">
          <Brand />
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4">
          <NavGroups pathname={pathname} layoutId="sidebar" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-(--ws-header) min-w-0 shrink-0 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur-md sm:gap-3 sm:px-5 lg:px-7">
          <MobileNav pathname={pathname} />
          <Link to="/research" aria-label="Harbor home" className="flex shrink-0 items-center lg:hidden">
            <HarborMark className="size-7 text-primary" />
          </Link>
          <p className="truncate text-[15px] font-medium tracking-[-0.01em]">{pageTitle(pathname)}</p>
          <div className="ml-auto flex shrink-0 items-center gap-2 [&_[data-slot=button]]:h-9 pointer-coarse:[&_[data-slot=button]]:h-11">
            <div className="hidden md:block">
              <ExecutionChip />
            </div>
            <WalletButton />
          </div>
        </header>

        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          {/* Ask Harbor opens on the left, beside the navigation it was called from. */}
          {desktop && assistantOpen ? (
            <>
              <ResizablePanel
                id="assistant-panel"
                panelRef={assistantRef}
                defaultSize={assistantWidth}
                minSize={320}
                maxSize={520}
                groupResizeBehavior="preserve-pixel-size"
                onResize={(size) => setAssistantWidth(size.inPixels)}
              >
                <AdjacentAssistant />
              </ResizablePanel>
              <ResizableHandle
                withHandle
                aria-label="Resize assistant"
                aria-valuetext={`${Math.round(assistantWidth)} pixels`}
                onDoubleClick={() => assistantRef.current?.resize(380)}
              />
            </>
          ) : null}
          <ResizablePanel id="workspace-panel" minSize={desktop && assistantOpen ? 520 : 0}>
            <div id="workspace-scroll" ref={workspaceScrollRef} className="relative h-full overflow-y-auto">
              <WorkspaceContent pathname={pathname}>{children}</WorkspaceContent>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <BottomNav pathname={pathname} />
      {pathname !== '/chat' && !assistantOpen ? (
        <div className="fixed bottom-[calc(84px+env(safe-area-inset-bottom,0px))] left-4 z-40 md:bottom-6 lg:left-[calc(var(--ws-sidebar)+24px)]">
          <AgentPanel desktop={desktop} />
        </div>
      ) : null}
      {!desktop && assistantOpen ? <AgentPanel desktop={false} /> : null}
    </div>
  );
}

function WorkspaceContent({ pathname, children }: { pathname: string; children: ReactNode }) {
  const chatPage = pathname === '/chat';
  return (
    <main
      id="workspace"
      className={`mx-auto w-full min-w-0 max-w-[1320px] px-4 pt-6 sm:px-6 lg:px-8 lg:pt-8 ${chatPage ? 'flex h-full flex-col overflow-hidden pb-[84px] md:pb-6' : 'pb-28 md:pb-12'}`}
    >
      {/* Keyed by route: the body fades up as the chrome holds still. */}
      <div key={pathname} className={`ws-page ${chatPage ? 'flex min-h-0 flex-1 flex-col' : ''}`}>
        <Suspense fallback={<PageSkeleton />}>{children ?? <Outlet />}</Suspense>
      </div>
    </main>
  );
}

function pageTitle(pathname: string): string {
  if (pathname.startsWith('/plans')) return 'Plan';
  if (pathname.startsWith('/settings/policy')) return 'Policy';
  if (pathname === '/chat') return 'Ask Harbor';
  return ROUTES.find((route) => pathname.startsWith(route.to))?.label ?? 'Workspace';
}

function isActiveGroup(pathname: string, route: string) {
  if (route === '/portfolio') return pathname.startsWith('/portfolio') || pathname.startsWith('/plans');
  return pathname.startsWith(route);
}

function Brand() {
  return (
    <Link to="/research" className="flex items-center gap-2 focus-visible:outline-offset-4" aria-label="Harbor home">
      <HarborLogo size="lg" />
    </Link>
  );
}

function NavGroups({
  pathname,
  layoutId,
  onNavigate,
}: {
  pathname: string;
  layoutId: string;
  onNavigate?: () => void;
}) {
  return (
    <LayoutGroup id={layoutId}>
      <nav aria-label="Primary">
        <ul className="space-y-0.5">
          {ROUTES.map((item) => (
            <li key={item.to}>
              <NavLink item={item} active={isActiveGroup(pathname, item.to)} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
        <p className="ws-label mt-6 mb-1.5 px-2.5">Settings</p>
        <ul className="space-y-0.5">
          {SETTINGS.map((item) => (
            <li key={item.to}>
              <NavLink item={item} active={isActiveGroup(pathname, item.to)} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      </nav>
    </LayoutGroup>
  );
}

/** A nav row. The active fill is one shared element that travels to the row you choose. */
function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: (() => void) | undefined;
}) {
  const reduced = useReducedMotion();
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`group relative flex h-9 items-center gap-3 rounded-md px-2.5 text-[14px] font-medium transition-colors duration-150 pointer-coarse:h-11 ${active ? 'text-foreground' : 'text-muted-foreground hover:bg-secondary/55 hover:text-foreground'}`}
    >
      {active ? (
        <motion.span
          layoutId="nav-active"
          aria-hidden="true"
          className="absolute inset-0 rounded-md bg-secondary"
          transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 42, mass: 0.9 }}
        />
      ) : null}
      <Icon
        aria-hidden="true"
        strokeWidth={1.75}
        className={`relative size-4 shrink-0 transition-colors duration-150 ${active ? 'text-primary' : ''}`}
      />
      <span className="relative">{item.label}</span>
    </Link>
  );
}

function MobileNav({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open navigation"
            className="-ml-1 size-9 text-muted-foreground lg:hidden pointer-coarse:size-11"
          />
        }
      >
        <Menu />
      </SheetTrigger>
      <SheetContent side="left" className="w-[min(84vw,18rem)] gap-0 p-0">
        <div className="flex h-(--ws-header) items-center border-b border-border px-5">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Brand />
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4">
          <NavGroups pathname={pathname} layoutId="sheet" onNavigate={() => setOpen(false)} />
        </div>
        <SheetClose className="sr-only">Close navigation</SheetClose>
      </SheetContent>
    </Sheet>
  );
}

function BottomNav({ pathname }: { pathname: string }) {
  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-background/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      {ROUTES.map((route) => {
        const active = isActiveGroup(pathname, route.to);
        const Icon = route.icon;
        return (
          <Link
            key={route.to}
            to={route.to}
            aria-current={active ? 'page' : undefined}
            className={`flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${active ? 'text-foreground' : 'text-muted-foreground'}`}
          >
            <Icon aria-hidden="true" strokeWidth={1.75} className={`size-5 ${active ? 'text-primary' : ''}`} />
            {route.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** The execution state, in the header on wide screens. */
function ExecutionChip() {
  const health = useHealth();
  if (health.isPending) return <span className="block h-7 w-36 animate-pulse rounded-md bg-secondary" />;
  if (health.isError || !health.data.ok) {
    return <span className="text-[12.5px] text-destructive">Connection unavailable</span>;
  }
  return (
    <dl className="flex items-center gap-4 pr-2 text-[12.5px]">
      <div className="flex items-center gap-2">
        <dt className="text-muted-foreground">Network</dt>
        <dd className="font-medium">{health.data.network === 'mainnet' ? 'Mainnet' : 'Testnet'}</dd>
      </div>
      <span aria-hidden="true" className="h-4 w-px bg-border" />
      <div className="flex items-center gap-2">
        <dt className="text-muted-foreground">Execution</dt>
        <dd className="flex items-center gap-1.5 font-medium">
          <span
            aria-hidden="true"
            className={`size-1.5 rounded-full ${health.data.executionEnabled ? 'bg-success' : 'bg-warning'}`}
          />
          {health.data.executionEnabled ? 'On' : 'Review only'}
        </dd>
      </div>
    </dl>
  );
}

function WalletButton() {
  const { address, connecting, restoring, connect, disconnect, error } = useWallet();
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

  if (restoring)
    return (
      <span
        role="status"
        aria-label="Loading"
        className="block h-9 w-9 animate-pulse rounded-md bg-secondary sm:w-36"
      />
    );
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
                className="gap-2 px-2.5"
              />
            }
          >
            <AccountDot address={address} />
            <span className="hidden text-[13px] sm:inline">{shortAddress(address)}</span>
            <ChevronDown className="hidden size-3.5 text-muted-foreground sm:block" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8} aria-label="Wallet account" className="w-60 p-1.5">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex items-center gap-2.5 px-2 pt-2 pb-2.5 font-normal">
                <AccountDot address={address} />
                <span className="min-w-0">
                  <span className="block text-[12px] text-muted-foreground">Connected account</span>
                  <span className="block truncate text-[13px] font-medium text-foreground">
                    {shortAddress(address)}
                  </span>
                </span>
              </DropdownMenuLabel>
              <DropdownMenuItem closeOnClick={false} onClick={copyAddress} className="min-h-10 gap-2.5 px-2">
                {copyStatus === 'copied' ? (
                  <Check className="size-4 text-success" aria-hidden="true" />
                ) : (
                  <Copy className="size-4" aria-hidden="true" />
                )}
                {copyStatus === 'copied' ? 'Address copied' : 'Copy address'}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={disconnect} className="min-h-10 gap-2.5 px-2">
              <LogOut className="size-4" aria-hidden="true" />
              Disconnect
            </DropdownMenuItem>
            {copyStatus === 'failed' ? (
              <p role="alert" className="px-2 py-2 text-xs leading-relaxed text-destructive">
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
          className="gap-2 px-3"
        >
          {connecting ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Wallet />}
          <span className="hidden sm:inline">{connecting ? 'Connecting…' : 'Connect wallet'}</span>
        </Button>
      )}
      {error ? (
        <p
          role="alert"
          className="absolute top-full right-0 z-50 mt-2.5 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-destructive/25 bg-popover p-3 text-xs leading-relaxed text-destructive shadow-[var(--ws-shadow-raised)]"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
