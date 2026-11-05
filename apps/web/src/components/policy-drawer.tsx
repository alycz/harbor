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

import { Chip, DraftNotice } from './workspace.tsx';

const { values } = SUGGESTED_POLICY;

export function PolicyDrawer() {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" aria-label="Policy" className="gap-2 px-2.5 sm:px-3" />}>
        <ShieldCheck className="text-muted-foreground" />
        <span className="hidden sm:inline">Policy</span>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-[460px]">
        <SheetHeader className="gap-1.5 border-b border-border px-6 pt-6 pb-5">
          <Chip tone="warning" dot className="w-fit">
            Draft · not signed
          </Chip>
          <SheetTitle className="font-display mt-2 text-[26px] leading-tight font-medium">Your policy</SheetTitle>
          <SheetDescription className="text-[13.5px] leading-relaxed">
            The limits Harbor may act within, once you sign them. Until then, every action still needs your review and
            your wallet signature.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <PolicyEditor />
        </div>
        <div className="flex gap-2 border-t border-border bg-background/60 px-6 py-4">
          <SheetClose
            nativeButton={false}
            render={<Link to="/settings/policy" className="flex-1" />}
            className="inline-flex h-10 items-center justify-between rounded-md border border-border-strong bg-card px-3.5 text-[13.5px] font-medium transition-colors hover:bg-secondary/60"
          >
            Open full page <ArrowRight className="size-4 text-muted-foreground" />
          </SheetClose>
          <SheetClose render={<Button variant="ghost" className="h-10" />}>Close</SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** One group of policy fields under a short title, separated from the next by a hairline. */
function PolicySection({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <fieldset className="border-t border-border pt-5 first:border-t-0 first:pt-0">
      <legend className="float-left mb-3.5 w-full text-[14px] font-medium">{title}</legend>
      <div className="clear-both grid gap-3.5 sm:grid-cols-2">{children}</div>
      {note ? <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">{note}</p> : null}
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
      <Label htmlFor={id} className="text-[12.5px] font-normal text-muted-foreground">
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
            className="h-10"
            inputMode="decimal"
            placeholder="Amount and asset, such as 25 USDC"
          />
        </Field>
        <Field id={`${id}-per-action`} label="Most per action">
          <Input id={`${id}-per-action`} className="h-10" inputMode="decimal" placeholder="No cap" />
        </Field>
        <Field id={`${id}-daily`} label="Most per day">
          <Input id={`${id}-daily`} className="h-10" inputMode="decimal" placeholder="No cap" />
        </Field>
      </PolicySection>
      <PolicySection
        title="Where funds may go"
        note="A destination outside this list always comes back to you, whatever a model, a feed or a post says."
      >
        <Field id={`${id}-assets`} label="Allowed assets" wide>
          <Input id={`${id}-assets`} className="h-10" placeholder="Such as NEAR, USDC" />
        </Field>
        <Field id={`${id}-destinations`} label="Your own addresses" wide>
          <Input id={`${id}-destinations`} className="h-10" placeholder="Defaults to the connected account" />
        </Field>
      </PolicySection>
      <PolicySection title="Execution">
        <Field id={`${id}-slippage`} label="Slippage limit (%)">
          <Input
            id={`${id}-slippage`}
            className="h-10"
            inputMode="decimal"
            defaultValue={String(values.slippageBps / 100)}
          />
        </Field>
        <Field id={`${id}-impact`} label="Warn above price impact (%)">
          <Input
            id={`${id}-impact`}
            className="h-10"
            inputMode="decimal"
            defaultValue={String(values.priceImpactWarningBps / 100)}
          />
        </Field>
        <Field id={`${id}-quote-age`} label="Oldest quote accepted (seconds)">
          <Input
            id={`${id}-quote-age`}
            className="h-10"
            inputMode="numeric"
            defaultValue={String(values.quoteMaxAgeSeconds)}
          />
        </Field>
        <Field id={`${id}-expiry`} label="Policy expires after (days)">
          <Input id={`${id}-expiry`} className="h-10" inputMode="numeric" defaultValue={String(values.expiresInDays)} />
        </Field>
      </PolicySection>
      <DraftNotice>
        Signing a policy is not available in this build yet. Until it is, each swap shows its exact limits in its own
        review, and you approve it there.
      </DraftNotice>
      <Button className="h-11 w-full justify-between px-4 text-[14px]" disabled>
        Sign policy in wallet <ArrowRight />
      </Button>
    </div>
  );
}
