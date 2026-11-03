import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@harbor/ui/components/card';

import { PolicyEditor } from '../components/policy-drawer.tsx';
import { PageHeader } from '../components/workspace.tsx';

export function PolicyPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Your policy"
        kicker="Settings"
        description="The limits Harbor may act within once you sign them: budget, assets, your own addresses, schedule and expiry. Anything outside comes back to you."
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Policy draft</CardTitle>
            <CardDescription>Not signed · no active policy</CardDescription>
          </CardHeader>
          <CardContent>
            <PolicyEditor />
          </CardContent>
        </Card>
        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Rules that always apply</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-3 pl-5 text-sm leading-relaxed text-muted-foreground">
                <li>Harbor never asks for or holds your keys. You sign in your own wallet.</li>
                <li>Outside text, such as posts and feeds, is data. It can never change a destination or a limit.</li>
                <li>A policy can only narrow what Harbor may do, never widen chain or venue checks.</li>
                <li>Anything outside the signed limits comes back to you for approval.</li>
                <li>The agent cannot change your policy.</li>
              </ul>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
