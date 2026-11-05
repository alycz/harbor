import { Check, ShieldCheck } from 'lucide-react';

import { PolicyEditor } from '../components/policy-editor.tsx';
import { Chip, PageHeader, Panel } from '../components/workspace.tsx';

const RULES = [
  'Harbor never asks for or holds your keys. You sign in your own wallet.',
  'Outside text, such as posts and feeds, is data. It can never change a destination or a limit.',
  'A policy can only narrow what Harbor may do, never widen its chain or venue checks.',
  'Anything outside the signed limits comes back to you for approval.',
  'The agent cannot change your policy.',
] as const;

export function PolicyPage() {
  return (
    <div className="ws-stagger flex flex-col gap-7">
      <PageHeader
        title="Your policy"
        description="The limits Harbor may act within once you sign them: budget, assets, your own addresses, schedule and expiry. Anything outside them comes back to you."
      />
      <div className="grid items-start gap-5 @3xl/workspace:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <Panel
          label="Policy draft"
          icon={<ShieldCheck />}
          aside={
            <Chip tone="warning" dot>
              Not signed
            </Chip>
          }
          labelId="policy-draft"
          bodyClassName="p-5 @xl/workspace:p-6"
        >
          <PolicyEditor />
        </Panel>
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
