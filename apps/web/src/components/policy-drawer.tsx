import { SUGGESTED_POLICY } from '@harbor/policy/policy';
import { Badge } from '@harbor/ui/components/badge';
import { Button } from '@harbor/ui/components/button';
import { Input } from '@harbor/ui/components/input';
import { Label } from '@harbor/ui/components/label';
import { Separator } from '@harbor/ui/components/separator';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@harbor/ui/components/sheet';
import { ShieldCheck } from 'lucide-react';
import { useId } from 'react';

import { DraftNotice } from './workspace.tsx';

const { values } = SUGGESTED_POLICY;

export function PolicyDrawer() {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" aria-label="Policy" className="bg-transparent!" />}>
        <ShieldCheck />
        <span className="hidden sm:inline">Policy</span>
      </SheetTrigger>
      <SheetContent className="harbor-workspace w-full sm:max-w-[440px]">
        <SheetHeader>
          <SheetTitle>Policy · draft</SheetTitle>
          <SheetDescription>
            The limits Harbor may act within, once you sign them. This draft is not signed or enforced yet; every action
            still needs your review and wallet signature.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          <PolicyEditor />
        </div>
        <div className="border-t p-4">
          <SheetClose render={<Button variant="ghost" className="w-full" />}>Close draft</SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function PolicyEditor() {
  const id = useId();
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">Draft · not signed</Badge>
        <Badge variant="secondary">Suggested values</Badge>
      </div>
      <fieldset className="space-y-4">
        <legend className="mb-3 font-medium">Budget</legend>
        <div className="space-y-2">
          <Label htmlFor={`${id}-budget`}>Total budget</Label>
          <Input id={`${id}-budget`} inputMode="decimal" placeholder="Amount and asset, such as 25 USDC" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${id}-per-action`}>Per-action cap</Label>
            <Input id={`${id}-per-action`} inputMode="decimal" placeholder="Off" />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-daily`}>Daily cap</Label>
            <Input id={`${id}-daily`} inputMode="decimal" placeholder="Off" />
          </div>
        </div>
      </fieldset>
      <Separator />
      <fieldset className="space-y-4">
        <legend className="mb-3 font-medium">Where funds may go</legend>
        <div className="space-y-2">
          <Label htmlFor={`${id}-assets`}>Allowed assets</Label>
          <Input id={`${id}-assets`} placeholder="Such as NEAR, USDC" />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-destinations`}>Your own addresses only</Label>
          <Input id={`${id}-destinations`} placeholder="Defaults to the connected account" />
        </div>
        <p className="text-xs text-muted-foreground">
          A destination outside this list always comes back to you, whatever a model, a feed or a post says.
        </p>
      </fieldset>
      <Separator />
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 font-medium">Execution</legend>
        <div className="space-y-2">
          <Label htmlFor={`${id}-slippage`}>Slippage (%)</Label>
          <Input id={`${id}-slippage`} inputMode="decimal" defaultValue={String(values.slippageBps / 100)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-impact`}>Price impact warning (%)</Label>
          <Input id={`${id}-impact`} inputMode="decimal" defaultValue={String(values.priceImpactWarningBps / 100)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-quote-age`}>Maximum quote age (seconds)</Label>
          <Input id={`${id}-quote-age`} inputMode="numeric" defaultValue={String(values.quoteMaxAgeSeconds)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-expiry`}>Expires after (days)</Label>
          <Input id={`${id}-expiry`} inputMode="numeric" defaultValue={String(values.expiresInDays)} />
        </div>
      </fieldset>
      <DraftNotice>
        Signing a policy is not available in this build. Each action's exact limits are shown in its own review.
      </DraftNotice>
      <Button className="w-full" disabled>
        Sign policy in wallet
      </Button>
    </div>
  );
}
