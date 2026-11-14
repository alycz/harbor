import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';
import { type ComponentType, type ReactNode, useEffect } from 'react';

import { LeashVault } from '../components/leash-vault.tsx';
import { PolicySection } from '../components/policy-section.tsx';
import { Chip, type ChipTone, PageHeader, SectionTitle } from '../components/workspace.tsx';
import { call } from '../lib/execution.ts';
import { policies } from '../lib/policy.ts';
import { useWallet } from '../lib/wallet.tsx';

/**
 * Everything Harbor's agent may do on its own: the budget it spends, enforced by a NEAR contract, and what
 * else limits it: the agent's narrow key, and the owner's signed policy for every other trade and automation.
 */
export function AgentPage() {
  const wallet = useWallet();
  // A link to #policy can arrive before this page's code has loaded, so the router's own scroll finds nothing.
  useEffect(() => {
    if (window.location.hash !== '#policy') return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('policy')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }, []);
  const leash = useQuery({
    queryKey: ['leash-ids', wallet.address],
    queryFn: () => call<{ contractId: string; agentAccountId: string }>('/api/leash/vault'),
    enabled: Boolean(wallet.address),
    retry: false,
  });
  const policy = useQuery({
    queryKey: ['policy', wallet.address],
    queryFn: policies.current,
    enabled: Boolean(wallet.address),
  });
  const contract = leash.data?.contractId ?? 'harbor-leash.near';
  const agent = leash.data?.agentAccountId ?? 'harbor-agent.near';
  const current = policy.data?.policy ?? null;
  const policyState: { tone: ChipTone; label: string } = !wallet.address
    ? { tone: 'neutral', label: 'Connect to see it' }
    : current?.status === 'active'
      ? { tone: 'success', label: 'Signed and active' }
      : current?.status === 'frozen'
        ? { tone: 'warning', label: 'Frozen' }
        : { tone: 'neutral', label: 'Not signed yet' };

  return (
    <div className="ws-stagger flex flex-col gap-7">
      <PageHeader
        title="Agent"
        description="A budget Harbor's agent can spend without asking you each time. A NEAR contract holds the money and refuses any trade outside the rules you set."
        actions={
          <Link
            to="/agent"
            hash="policy"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3.5 text-[13px] font-medium transition-colors hover:bg-secondary/60"
          >
            <ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true" />
            Your policy
          </Link>
        }
      />

      <LeashVault />

      <section aria-labelledby="agent-guards" className="flex flex-col gap-3.5">
        <SectionTitle id="agent-guards" title="What limits the agent" />
        <ul className="grid list-none gap-3 @3xl/workspace:grid-cols-3">
          <Guard
            icon={LockKeyhole}
            title="The vault contract"
            status={<span className="text-[13px] font-medium break-all">{contract}</span>}
            body="Holds the budget and checks every trade against your rules before it pays. Harbor sends nothing if the contract's code ever changes."
            link={
              <a href={`https://nearblocks.io/address/${contract}`} target="_blank" rel="noreferrer" className={LINK}>
                View on NEARBlocks
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </a>
            }
          />
          <Guard
            icon={KeyRound}
            title="The agent's key"
            status={<span className="text-[13px] font-medium break-all">{agent}</span>}
            body="Can only ask the vault to pay for a quote you approved. It cannot withdraw, change your rules, or touch anything else."
            link={
              <a href={`https://nearblocks.io/address/${agent}`} target="_blank" rel="noreferrer" className={LINK}>
                See its keys on NEARBlocks
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </a>
            }
          />
          <Guard
            icon={ShieldCheck}
            title="Your policy"
            status={
              <Chip tone={policyState.tone} dot>
                {policyState.label}
              </Chip>
            }
            body="Limits every trade Harbor prepares for you to sign, in chat or from a schedule: how much, to which addresses, and how often the agent may act. Freeze it and the schedule stops."
            link={
              <Link to="/agent" hash="policy" className={LINK}>
                {current ? 'Review your policy' : 'Sign a policy'}
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </Link>
            }
          />
        </ul>
      </section>

      <PolicySection />
    </div>
  );
}

const LINK =
  'inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--ws-accent-ink)] underline-offset-4 hover:underline';

/** One limit on the agent: what it is, its live state, what it guarantees, and where to check it yourself. */
function Guard({
  icon: Icon,
  title,
  status,
  body,
  link,
}: {
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>;
  title: string;
  status: ReactNode;
  body: string;
  link: ReactNode;
}) {
  return (
    <li className="ws-card flex flex-col gap-3 p-5">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-lg bg-[var(--harbor-accent-tint)] text-[var(--ws-accent-ink)]">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <h3 className="text-[14px] font-medium">{title}</h3>
      </div>
      <div>{status}</div>
      <p className="flex-1 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
      <div>{link}</div>
    </li>
  );
}
