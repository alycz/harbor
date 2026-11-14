import { Button } from '@harbor/ui/components/button';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleCheck, OctagonX, ShieldCheck, Snowflake, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { formatUtc } from '../lib/format.ts';
import { policies, type SignedPolicyView } from '../lib/policy.ts';
import { useWallet } from '../lib/wallet.tsx';
import { StrategiesPanel } from './autopilot.tsx';
import { PolicyEditor } from './policy-editor.tsx';
import { Chip, EmptyState, FactRow, Panel, SectionTitle } from './workspace.tsx';

const RULES = [
  'Harbor never asks for or holds your keys. You sign in your own wallet.',
  'Outside text, such as posts and feeds, is data. It can never change a destination or a limit.',
  'Funds only go to your own addresses. No approval can send them anywhere else.',
  'Anything outside the signed limits comes back to you for approval.',
  'The agent cannot change your policy, and a freeze stops it at once.',
] as const;

/**
 * The owner's signed policy: the limits on every trade Harbor prepares for them to sign, the schedule the agent
 * runs on, and the editor to sign a new revision. It sits under the agent's budget on the Agent page.
 */
export function PolicySection() {
  const wallet = useWallet();
  const current = useQuery({
    queryKey: ['policy', wallet.address],
    queryFn: policies.current,
    enabled: Boolean(wallet.address),
  });
  const policy = current.data?.policy ?? null;
  const live = policy && policy.status !== 'revoked' ? policy : null;
  // The revision the owner just signed: the page scrolls up to it, so they see what changed.
  const [justSigned, setJustSigned] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);
  const liveRevision = live?.revision;
  useEffect(() => {
    // Wait for the signed revision itself to render; the query cache can update a tick after the callback.
    if (justSigned === null || justSigned !== liveRevision) return;
    const heading = document.getElementById('signed-policy');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    heading?.closest('section')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    // Move focus with the view, so a screen reader announces the signed policy too.
    heading?.setAttribute('tabindex', '-1');
    heading?.focus({ preventScroll: true });
    setFlash(true);
    const timer = window.setTimeout(() => setFlash(false), 2400);
    return () => window.clearTimeout(timer);
  }, [justSigned, liveRevision]);

  return (
    <section aria-labelledby="policy" className="flex scroll-mt-6 flex-col gap-4">
      <div>
        <SectionTitle id="policy" title="Your policy" />
        <p className="mt-1.5 max-w-[62ch] text-[13.5px] leading-relaxed text-muted-foreground">
          The limits on every trade Harbor prepares for you to sign, in chat or from a schedule. Sign it in your wallet;
          it moves no funds.
        </p>
      </div>
      <div className="grid items-start gap-5 @3xl/workspace:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          {!wallet.address && !wallet.restoring ? (
            <Panel>
              <EmptyState
                icon={<Wallet />}
                title="Connect the wallet whose limits you want to set"
                description="A policy belongs to one account, and only that account's wallet can sign it."
              >
                <Button className="h-10 gap-2 px-4" onClick={wallet.connect} disabled={wallet.connecting}>
                  <Wallet /> {wallet.connecting ? 'Connecting…' : 'Connect wallet'}
                </Button>
              </EmptyState>
            </Panel>
          ) : null}
          {live ? <SignedPolicy policy={live} justSigned={justSigned === live.revision} flash={flash} /> : null}
          {live ? <StrategiesPanel /> : null}
          {wallet.address && current.isSuccess ? (
            <Panel
              label={live ? 'Sign a new revision' : 'Policy draft'}
              icon={<ShieldCheck />}
              aside={
                <Chip tone="warning" dot>
                  Not signed
                </Chip>
              }
              labelId="policy-draft"
              bodyClassName="p-5 @xl/workspace:p-6"
            >
              <PolicyEditor
                key={live?.id ?? 'none'}
                current={live}
                onSigned={(signed) => setJustSigned(signed.revision)}
              />
            </Panel>
          ) : null}
        </div>
        <section aria-labelledby="policy-rules" className="ws-hero @3xl/workspace:sticky @3xl/workspace:top-6">
          <div className="p-6 @xl/workspace:p-7">
            <h2 id="policy-rules" className="font-display text-[28px] leading-[1.12] font-medium text-band-foreground">
              Rules no policy can change.
            </h2>
            <ul className="mt-6">
              {RULES.map((rule) => (
                <li
                  key={rule}
                  className="flex gap-3 border-t border-[var(--ws-band-rule)] py-3.5 text-[13.5px] leading-relaxed text-[#d9d6ce]"
                >
                  <span
                    aria-hidden="true"
                    className="mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full bg-white/8 text-[var(--harbor-sky)]"
                  >
                    <Check className="size-3" strokeWidth={2.5} />
                  </span>
                  {rule}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </section>
  );
}

/** The policy in force: its limits, what is already committed against them, and the freeze. */
function SignedPolicy({
  policy,
  justSigned,
  flash,
}: {
  policy: SignedPolicyView;
  justSigned: boolean;
  flash: boolean;
}) {
  const wallet = useWallet();
  const queryClient = useQueryClient();
  const change = useMutation({
    mutationFn: (action: 'freeze' | 'revoke') => (action === 'freeze' ? policies.freeze() : policies.revoke()),
    onSuccess: (result, action) => {
      queryClient.setQueryData(['policy', wallet.address], result);
      toast.success(
        action === 'freeze' ? 'Frozen. The agent cannot act on its own.' : 'Revoked. This policy no longer applies.',
      );
    },
  });
  const frozen = policy.status === 'frozen';
  return (
    <Panel
      className={`scroll-mt-6 transition-shadow duration-700 motion-reduce:transition-none ${
        flash && justSigned ? 'ring-2 ring-[var(--harbor-accent)] ring-offset-2 ring-offset-background' : ''
      }`}
      label={`Signed policy · revision ${policy.revision}`}
      icon={<ShieldCheck />}
      aside={
        <Chip tone={frozen ? 'danger' : 'success'} dot>
          {frozen ? 'Frozen' : 'Active'}
        </Chip>
      }
      labelId="signed-policy"
      bodyClassName="p-5 @xl/workspace:p-6"
    >
      {justSigned && !frozen ? (
        <p
          role="status"
          className="mb-4 flex items-start gap-2.5 rounded-lg border border-[var(--ws-accent-border)] bg-[var(--harbor-accent-tint)] px-3.5 py-3 text-[13px]"
        >
          <CircleCheck className="mt-px size-4 shrink-0 text-success" aria-hidden="true" />
          <span>
            Signed just now.{' '}
            {policy.revision > 1
              ? `Revision ${policy.revision} replaces revision ${policy.revision - 1}, and these limits are in force.`
              : 'These limits are in force.'}{' '}
            To change them again, edit the draft below and sign the next revision.
          </span>
        </p>
      ) : null}
      {frozen ? (
        <p className="mb-4 rounded-lg border border-destructive/20 bg-destructive/6 px-3.5 py-3 text-[13px]">
          Frozen {policy.frozenAt ? formatUtc(policy.frozenAt) : ''}. The agent cannot act on its own. Sign a new
          revision below to start it again.
        </p>
      ) : null}
      <dl>
        {policy.usage.map((usage) => (
          <FactRow
            key={usage.asset}
            label={`${usage.asset} spent`}
            value={`${usage.spentLastDay} of ${usage.perDay} today · ${usage.spentTotal} of ${usage.total} in total · up to ${usage.perAction} per action`}
          />
        ))}
        <FactRow label="May trade into" value={policy.assets.join(', ')} />
        <FactRow
          label="Funds may only go to"
          value={[
            `${policy.owner} (NEAR)`,
            ...policy.destinations.map((entry) => `${entry.address} (${entry.chain})`),
          ].join(', ')}
        />
        <FactRow
          label="Agent schedule"
          value={policy.agentEveryHours === null ? 'Once' : `At most every ${policy.agentEveryHours} h`}
        />
        <FactRow label="Slippage limit" value={`${policy.slippageMaxBps / 100}%`} />
        <FactRow label="Signed" value={policy.signedAt ? formatUtc(policy.signedAt) : '—'} />
        <FactRow label="Expires" value={formatUtc(policy.expiresAt)} />
        <FactRow label="Digest" value={<span className="font-mono text-[11.5px]">{policy.digest}</span>} />
      </dl>
      <div className="mt-5 flex flex-wrap gap-2.5">
        {!frozen ? (
          <Button
            variant="destructive"
            className="h-10 gap-2 px-4"
            disabled={change.isPending}
            onClick={() => change.mutate('freeze')}
          >
            <Snowflake /> Freeze the agent now
          </Button>
        ) : null}
        <Button
          variant="outline"
          className="h-10 gap-2 px-4"
          disabled={change.isPending}
          onClick={() => change.mutate('revoke')}
        >
          <OctagonX /> Revoke this policy
        </Button>
      </div>
      {change.isError ? <p className="mt-3 text-[13px] text-destructive">{change.error.message}</p> : null}
    </Panel>
  );
}
