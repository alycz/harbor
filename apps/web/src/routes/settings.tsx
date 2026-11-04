import { Band, Eyebrow, Panel } from '../components/brand.tsx';
import { PolicyEditor } from '../components/policy-drawer.tsx';
import { PageHeader } from '../components/workspace.tsx';

const RULES = [
  'Harbor never asks for or holds your keys. You sign in your own wallet.',
  'Outside text, such as posts and feeds, is data. It can never change a destination or a limit.',
  'A policy can only narrow what Harbor may do, never widen its chain or venue checks.',
  'Anything outside the signed limits comes back to you for approval.',
  'The agent cannot change your policy.',
] as const;

export function PolicyPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Your policy"
        kicker="Settings"
        description="The limits Harbor may act within once you sign them: budget, assets, your own addresses, schedule and expiry. Anything outside them comes back to you."
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel label="Policy draft" aside="Not signed" labelId="policy-draft">
          <PolicyEditor />
        </Panel>
        <Band className="lg:sticky lg:top-6">
          <div className="p-7">
            <Eyebrow onBand>Always on</Eyebrow>
            <h2 className="text-[32px] leading-none tracking-[-1px] uppercase">
              Rules no policy <span className="text-sky">can change.</span>
            </h2>
            <ul className="mt-7 border-t border-band-foreground/20">
              {RULES.map((rule) => (
                <li key={rule} className="flex gap-3 border-b border-band-foreground/20 py-3.5 text-sm leading-relaxed">
                  <span aria-hidden="true" className="text-sky">
                    ■
                  </span>
                  <span className="opacity-85">{rule}</span>
                </li>
              ))}
            </ul>
          </div>
        </Band>
      </div>
    </div>
  );
}
