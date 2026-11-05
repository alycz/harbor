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
import { Compass, TriangleAlert } from 'lucide-react';
import { lazy } from 'react';
import { AppShell } from './components/app-shell.tsx';

import { ChatSkeleton, LandingSkeleton, PageSkeleton } from './components/skeletons.tsx';
import { EmptyState, Panel } from './components/workspace.tsx';

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
  pendingComponent: PageSkeleton,
  component: lazy(() => import('./routes/research.tsx').then((module) => ({ default: module.ResearchPage }))),
});
const tradeRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/trade',
  pendingComponent: PageSkeleton,
  component: lazy(() => import('./routes/trade.tsx').then((module) => ({ default: module.TradePage }))),
});
const earnRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/earn',
  pendingComponent: PageSkeleton,
  component: lazy(() => import('./routes/earn.tsx').then((module) => ({ default: module.EarnPage }))),
});
const portfolioRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/portfolio',
  pendingComponent: PageSkeleton,
  component: lazy(() => import('./routes/portfolio.tsx').then((module) => ({ default: module.PortfolioPage }))),
});

const PlanPage = lazy(() => import('./routes/portfolio.tsx').then((module) => ({ default: module.PlanStatusPage })));
const planRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/plans/$planId',
  pendingComponent: PageSkeleton,
  component: PlanView,
});
const policyRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/settings/policy',
  pendingComponent: PageSkeleton,
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
    <Panel>
      <EmptyState
        icon={<TriangleAlert />}
        title="This page couldn't be loaded"
        description="Something went wrong on our side. Try again, or go back to research."
      >
        <Button className="h-10 px-4" onClick={reset}>
          Try again
        </Button>
      </EmptyState>
    </Panel>
  );
}

function PageNotFound() {
  return (
    <Panel>
      <EmptyState
        icon={<Compass />}
        title="Page not found"
        description="This link doesn't match a page in your workspace."
      >
        <Button nativeButton={false} className="h-10 px-4" render={<Link to="/research" />}>
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
