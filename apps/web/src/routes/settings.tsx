import { Button } from '@harbor/ui/components/button';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, OctagonX, ShieldCheck, Snowflake, Wallet } from 'lucide-react';

import { StrategiesPanel } from '../components/autopilot.tsx';
import { PolicyEditor } from '../components/policy-editor.tsx';
import { Chip, EmptyState, FactRow, PageHeader, Panel } from '../components/workspace.tsx';
import { formatUtc } from '../lib/format.ts';
import { policies, type SignedPolicyView } from '../lib/policy.ts';
import { useWallet } from '../lib/wallet.tsx';

const RULES = [
  'Harbor never asks for or holds your keys. You sign in your own wallet.',
  'Outside text, such as posts and feeds, is data. It can never change a destination or a limit.',
  'Funds only go to your own addresses. No approval can send them anywhere else.',
  'Anything outside the signed limits comes back to you for approval.',
  'The agent cannot change your policy, and a freeze stops it at once.',
] as const;

export function PolicyPage() {
  const wallet = useWallet();
  const current = useQuery({
    queryKey: ['policy', wallet.address],
    queryFn: policies.current,
    enabled: Boolean(wallet.address),
  });
  const policy = current.data?.policy ?? null;
  const live = policy && policy.status !== 'revoked' ? policy : null;

  return (
    <div className="ws-stagger flex flex-col gap-7">
      <PageHeader title="Your policy" />
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
          {live ? <SignedPolicy policy={live} /> : null}
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
              <PolicyEditor key={live?.id ?? 'none'} current={live} />
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
    </div>
  );
}

/** The policy in force: its limits, what is already committed against them, and the freeze. */
function SignedPolicy({ policy }: { policy: SignedPolicyView }) {
  const wallet = useWallet();
  const queryClient = useQueryClient();
  const change = useMutation({
    mutationFn: (action: 'freeze' | 'revoke') => (action === 'freeze' ? policies.freeze() : policies.revoke()),
    onSuccess: (result) => queryClient.setQueryData(['policy', wallet.address], result),
  });
  const frozen = policy.status === 'frozen';
  return (
    <Panel
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
