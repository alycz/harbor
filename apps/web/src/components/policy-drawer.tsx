import { SUGGESTED_POLICY } from '@harbor/policy/policy';
import { Button } from '@harbor/ui/components/button';
import { Input } from '@harbor/ui/components/input';
import { Label } from '@harbor/ui/components/label';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@harbor/ui/components/sheet';
import { Link } from '@tanstack/react-router';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { type ReactNode, useId } from 'react';

import { DraftNotice } from './workspace.tsx';

const { values } = SUGGESTED_POLICY;

export function PolicyDrawer() {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" aria-label="Policy" className="bg-transparent!" />}>
        <ShieldCheck />
        <span className="hidden sm:inline">Policy</span>
      </SheetTrigger>
      <SheetContent className="harbor-workspace w-full gap-0 sm:max-w-[460px]">
        <SheetHeader className="border-b border-line p-5">
          <p className="text-xs font-medium tracking-[0.6px] text-primary uppercase">■ Draft · not signed</p>
          <SheetTitle className="font-serif text-[28px] leading-none font-bold tracking-[-1px] uppercase">
            Your policy
          </SheetTitle>
          <SheetDescription>
            The limits Harbor may act within, once you sign them. Until then, every action still needs your review and
            your wallet signature.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <PolicyEditor />
        </div>
        <div className="flex gap-2 border-t border-line p-4">
          <SheetClose
            nativeButton={false}
            render={<Link to="/settings/policy" className="flex-1" />}
            className="inline-flex h-11 items-center justify-between border border-line px-4 text-sm hover:bg-secondary"
          >
            Open full page <ArrowRight className="size-4" />
          </SheetClose>
          <SheetClose render={<Button variant="ghost" className="h-11" />}>Close</SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** One group of policy fields, headed by an uppercase label on a rule. */
function PolicySection({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <fieldset className="border-t border-line pt-4 first:border-t-0 first:pt-0">
      <legend className="float-left mb-4 w-full text-[11px] font-medium tracking-[0.6px] uppercase">{title}</legend>
      <div className="clear-both grid gap-4 sm:grid-cols-2">{children}</div>
      {note ? <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{note}</p> : null}
    </fieldset>
  );
}

function Field({
  id,
  label,
  wide = false,
  children,
}: {
  id: string;
  label: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`space-y-2 ${wide ? 'sm:col-span-2' : ''}`}>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

export function PolicyEditor() {
  const id = useId();
  return (
    <div className="space-y-6">
      <PolicySection title="Budget">
        <Field id={`${id}-budget`} label="Total budget" wide>
          <Input
            id={`${id}-budget`}
            className="h-11"
            inputMode="decimal"
            placeholder="Amount and asset, such as 25 USDC"
          />
        </Field>
        <Field id={`${id}-per-action`} label="Most per action">
          <Input id={`${id}-per-action`} className="h-11" inputMode="decimal" placeholder="No cap" />
        </Field>
        <Field id={`${id}-daily`} label="Most per day">
          <Input id={`${id}-daily`} className="h-11" inputMode="decimal" placeholder="No cap" />
        </Field>
      </PolicySection>
      <PolicySection
        title="Where funds may go"
        note="A destination outside this list always comes back to you, whatever a model, a feed or a post says."
      >
        <Field id={`${id}-assets`} label="Allowed assets" wide>
          <Input id={`${id}-assets`} className="h-11" placeholder="Such as NEAR, USDC" />
        </Field>
        <Field id={`${id}-destinations`} label="Your own addresses" wide>
          <Input id={`${id}-destinations`} className="h-11" placeholder="Defaults to the connected account" />
        </Field>
      </PolicySection>
      <PolicySection title="Execution">
        <Field id={`${id}-slippage`} label="Slippage limit (%)">
          <Input
            id={`${id}-slippage`}
            className="h-11"
            inputMode="decimal"
            defaultValue={String(values.slippageBps / 100)}
          />
        </Field>
        <Field id={`${id}-impact`} label="Warn above price impact (%)">
          <Input
            id={`${id}-impact`}
            className="h-11"
            inputMode="decimal"
            defaultValue={String(values.priceImpactWarningBps / 100)}
          />
        </Field>
        <Field id={`${id}-quote-age`} label="Oldest quote accepted (seconds)">
          <Input
            id={`${id}-quote-age`}
            className="h-11"
            inputMode="numeric"
            defaultValue={String(values.quoteMaxAgeSeconds)}
          />
        </Field>
        <Field id={`${id}-expiry`} label="Policy expires after (days)">
          <Input id={`${id}-expiry`} className="h-11" inputMode="numeric" defaultValue={String(values.expiresInDays)} />
        </Field>
      </PolicySection>
      <DraftNotice>
        Signing a policy is not available in this build yet. Until it is, each swap shows its exact limits in its own
        review, and you approve it there.
      </DraftNotice>
      <Button className="h-14 w-full justify-between px-[22px]" disabled>
        Sign policy in wallet <ArrowRight />
      </Button>
    </div>
  );
}
