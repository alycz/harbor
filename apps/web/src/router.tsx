import { Button } from '@harbor/ui/components/button';
import {
  createRootRoute,
  createRoute,
  createRouter,
  type ErrorComponentProps,
  Link,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { lazy } from 'react';

import { AppShell } from './components/app-shell.tsx';
import { Panel } from './components/brand.tsx';
import {
  ChatSkeleton,
  EarnSkeleton,
  LandingSkeleton,
  PlanSkeleton,
  PolicySkeleton,
  PortfolioSkeleton,
  ResearchSkeleton,
  TradeSkeleton,
} from './components/skeletons.tsx';
import { EmptyState } from './components/workspace.tsx';

// The landing page renders on its own; every other page sits inside the workspace shell.
const rootRoute = createRootRoute({
  component: Outlet,
  errorComponent: (props) => (
    <AppShell>
      <PageError {...props} />
    </AppShell>
  ),
  notFoundComponent: () => (
    <AppShell>
      <PageNotFound />
    </AppShell>
  ),
});
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  pendingComponent: LandingSkeleton,
  component: lazy(() => import('./routes/landing.tsx').then((module) => ({ default: module.LandingPage }))),
});
const workspaceRoute = createRoute({ getParentRoute: () => rootRoute, id: 'workspace', component: AppShell });
const ChatPage = lazy(() => import('./routes/chat.tsx').then((module) => ({ default: module.ChatPage })));
const chatRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/chat',
  // `ask` arrives from the landing page and pre-fills the composer; it is never sent automatically.
  validateSearch: (search: Record<string, unknown>): { ask?: string } =>
    typeof search.ask === 'string' && search.ask.trim() ? { ask: search.ask.slice(0, 4000) } : {},
  pendingComponent: ChatSkeleton,
  component: ChatView,
});
const researchRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/research',
  pendingComponent: ResearchSkeleton,
  component: lazy(() => import('./routes/research.tsx').then((module) => ({ default: module.ResearchPage }))),
});
const tradeRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/trade',
  pendingComponent: TradeSkeleton,
  component: lazy(() => import('./routes/trade.tsx').then((module) => ({ default: module.TradePage }))),
});
const earnRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/earn',
  pendingComponent: EarnSkeleton,
  component: lazy(() => import('./routes/earn.tsx').then((module) => ({ default: module.EarnPage }))),
});
const portfolioRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/portfolio',
  pendingComponent: PortfolioSkeleton,
  component: lazy(() => import('./routes/portfolio.tsx').then((module) => ({ default: module.PortfolioPage }))),
});

const PlanPage = lazy(() => import('./routes/portfolio.tsx').then((module) => ({ default: module.PlanStatusPage })));
const planRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/plans/$planId',
  pendingComponent: PlanSkeleton,
  component: PlanView,
});
const policyRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/settings/policy',
  pendingComponent: PolicySkeleton,
  component: lazy(() => import('./routes/settings.tsx').then((module) => ({ default: module.PolicyPage }))),
});
const walletAlias = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/wallet',
  beforeLoad: () => {
    throw redirect({ to: '/portfolio', replace: true });
  },
});
const conversationsAlias = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/conversations',
  beforeLoad: () => {
    throw redirect({ to: '/chat' });
  },
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    workspaceRoute.addChildren([
      chatRoute,
      researchRoute,
      tradeRoute,
      earnRoute,
      portfolioRoute,
      planRoute,
      policyRoute,
      walletAlias,
      conversationsAlias,
    ]),
  ]),
});

function ChatView() {
  const { ask } = chatRoute.useSearch();
  return <ChatPage ask={ask} />;
}

function PlanView() {
  const { planId } = planRoute.useParams();
  return <PlanPage planId={planId} />;
}

function PageError({ reset }: ErrorComponentProps) {
  return (
    <Panel label="Something went wrong">
      <EmptyState title="This page couldn't be loaded" description="Try again, or go back to research.">
        <Button className="h-11" onClick={reset}>
          Try again
        </Button>
      </EmptyState>
    </Panel>
  );
}

function PageNotFound() {
  return (
    <Panel label="Not found">
      <EmptyState title="Page not found" description="This link doesn't match a page in your workspace.">
        <Button nativeButton={false} className="h-11" render={<Link to="/research" />}>
          Open research
        </Button>
      </EmptyState>
    </Panel>
  );
}

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
