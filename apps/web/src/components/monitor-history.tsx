import { Button } from '@harbor/ui/components/button';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { call } from '../lib/execution.ts';
import { formatUtc } from '../lib/format.ts';
import { useWallet } from '../lib/wallet.tsx';

interface MonitorDetail {
  evaluations: { id: string; evaluatedAt: string; result: string; reason: string; delayMs: number }[];
  alerts: { id: string; summary: string; createdAt: string; acknowledgedAt: string | null }[];
}

export function MonitorHistory({ id }: { id: string }) {
  const wallet = useWallet();
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: ['monitor-history', wallet.address, id],
    queryFn: () => call<MonitorDetail>(`/api/automations/${id}`),
    refetchInterval: 30_000,
  });
  const check = useMutation({
    mutationFn: () =>
      call<{ result: string; reason: string }>(`/api/automations/${id}/test`, { method: 'POST', body: {} }),
  });
  const acknowledge = useMutation({
    mutationFn: (alertId: string) =>
      call(`/api/automations/alerts/${alertId}/acknowledge`, { method: 'POST', body: {} }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['monitor-history', wallet.address, id] });
      await client.invalidateQueries({ queryKey: ['alerts', wallet.address] });
    },
  });
  return (
    <div className="mt-3 w-full space-y-3 rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-medium">Monitor activity</h3>
        <Button variant="outline" disabled={check.isPending} onClick={() => check.mutate()}>
          {check.isPending ? 'Checking…' : 'Check now'}
        </Button>
        <span className="text-xs text-muted-foreground">
          Check now is a read-only preview; it does not create an alert or trade.
        </span>
      </div>
      {check.data ? (
        <p role="status" className="text-sm">
          {check.data.reason}
        </p>
      ) : null}
      {check.isError ? (
        <p role="alert" className="text-destructive">
          {check.error.message}
        </p>
      ) : null}
      {detail.isPending ? <p>Loading history…</p> : null}
      {detail.isError ? (
        <p role="alert" className="text-destructive">
          {detail.error.message}
        </p>
      ) : null}
      {acknowledge.isError ? (
        <p role="alert" className="text-destructive">
          {acknowledge.error.message}
        </p>
      ) : null}
      {detail.data ? (
        <>
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Alerts</h4>
          {detail.data.alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No triggered alerts yet.</p>
          ) : (
            detail.data.alerts.map((alert) => (
              <div
                key={alert.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-2"
              >
                <div>
                  <p>{alert.summary}</p>
                  <p className="text-xs text-muted-foreground">{formatUtc(alert.createdAt)}</p>
                </div>
                {alert.acknowledgedAt ? (
                  <span className="text-xs text-muted-foreground">Acknowledged</span>
                ) : (
                  <Button
                    variant="outline"
                    disabled={acknowledge.isPending}
                    onClick={() => acknowledge.mutate(alert.id)}
                  >
                    Mark read
                  </Button>
                )}
              </div>
            ))
          )}
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recent scheduled checks</h4>
          {detail.data.evaluations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No scheduled checks yet. Active monitors run approximately every minute after deployment.
            </p>
          ) : (
            detail.data.evaluations.map((evaluation) => (
              <div key={evaluation.id} className="border-b border-border py-2">
                <p>{evaluation.reason}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatUtc(evaluation.evaluatedAt)} ·{' '}
                  {evaluation.result === 'unknown'
                    ? 'Unavailable'
                    : evaluation.result === 'true'
                      ? 'Condition met'
                      : 'Below threshold'}{' '}
                  · Scheduler delay {Math.max(0, Math.round(evaluation.delayMs / 1000))}s
                </p>
              </div>
            ))
          )}
        </>
      ) : null}
    </div>
  );
}
