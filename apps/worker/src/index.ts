import { AgentAdmission } from './agent/admission.ts';
import { ConversationAgent } from './agent/conversation.ts';
import { createApp } from './app.ts';
import { automationDeps, runAutomations } from './automations/dispatch.ts';
import { runAutopilot } from './autopilot/strategies.ts';
import { recoverPendingPlans } from './execution/recovery.ts';
import { settlePlans } from './execution/settlement.ts';
import { executionDeps } from './execution/store.ts';

const app = createApp();

export { AgentAdmission, ConversationAgent };

export default {
  fetch: app.fetch,
  /** Cron wakes the dispatcher about once a minute; due rules and leases live in D1, not here. */
  scheduled(_controller, env, ctx) {
    const execution = executionDeps(env);
    ctx.waitUntil(
      recoverPendingPlans(execution)
        .then(async (recovered) => ({ ...recovered, ...(await settlePlans(execution)) }))
        .then(async (settled) => ({ ...settled, autopilot: await runAutopilot(execution) }))
        .then(
          (summary) => console.log(JSON.stringify({ recovery: 'tick', ...summary })),
          (error: unknown) =>
            console.error(
              JSON.stringify({ recovery: 'tick_failed', error: error instanceof Error ? error.name : 'unknown' }),
            ),
        ),
    );
    ctx.waitUntil(
      runAutomations(automationDeps(env)).then(
        (summary) => console.log(JSON.stringify({ automation: 'tick', ...summary })),
        (error: unknown) =>
          console.error(
            JSON.stringify({ automation: 'tick_failed', error: error instanceof Error ? error.message : 'unknown' }),
          ),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
