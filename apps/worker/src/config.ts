import { NEAR_NETWORK_INFO } from '@harbor/domain/near';
import { type Network, NetworkSchema } from '@harbor/domain/network';
import { z } from 'zod';

const ConfigSchema = z.object({
  NEAR_NETWORK: NetworkSchema,
  EXECUTION_ENABLED: z.enum(['true', 'false']).transform((value) => value === 'true'),
});

const FauxStepSchema = z.union([
  z.strictObject({ text: z.string() }),
  z.strictObject({ toolCall: z.strictObject({ name: z.string(), args: z.record(z.string(), z.json()) }) }),
]);

// `.dev.vars` templates leave unset values as empty strings.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const AgentConfigSchema = z.discriminatedUnion('PI_PROVIDER', [
  z.object({
    PI_PROVIDER: z.literal('openrouter'),
    PI_MODEL_ID: z.string().min(1),
    OPENROUTER_API_KEY: optional(z.string().min(1)),
  }),
  // NEAR AI Cloud: private inference in TEEs; models.ts allows only attested models on NEAR's own fleet.
  z.object({
    PI_PROVIDER: z.literal('nearai'),
    PI_MODEL_ID: z.string().min(1),
    NEAR_AI_API_KEY: optional(z.string().min(1)),
  }),
  // Tests and local demos only: a scripted model that never calls a provider.
  // A Wrangler var may be a JSON value, so the script arrives as text or as an array.
  z.object({
    PI_PROVIDER: z.literal('faux'),
    PI_FAUX_SCRIPT: z.preprocess(parseJsonText, z.array(FauxStepSchema).min(1)),
  }),
]);

export interface Config {
  network: Network;
  executionEnabled: boolean;
}

export type FauxStep = z.infer<typeof FauxStepSchema>;

export type AgentConfig =
  | { provider: 'openrouter' | 'nearai'; modelId: string; apiKey: string }
  | { provider: 'faux'; script: FauxStep[] };

/** What the agent says when no model key is configured, so a fresh checkout still answers. */
export const KEYLESS_FAUX_SCRIPT: FauxStep[] = [
  {
    text: "This Harbor server has no model key set, so this reply is scripted. Research, Trade, Earn and your policy all work without one; the server's operator turns chat on with NEAR_AI_API_KEY or OPENROUTER_API_KEY.",
  },
];

/** Names the variables that failed to decode; never their values. */
export class ConfigError extends Error {
  override name = 'ConfigError';
  readonly variables: readonly string[];

  constructor(variables: readonly string[]) {
    super(`Invalid Worker configuration: ${variables.join(', ')}`);
    this.variables = variables;
  }
}

export function decodeConfig(env: unknown): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) throw new ConfigError(variablesOf(parsed.error));
  return { network: parsed.data.NEAR_NETWORK, executionEnabled: parsed.data.EXECUTION_ENABLED };
}

export interface AdmissionLimits {
  /** Turns one anonymous subject may start per window. */
  guestTurns: number;
  guestWindowMs: number;
  /** Model runs in flight at once across every conversation. */
  activeRuns: number;
}

const GUEST_WINDOW_MS = 15 * 60_000;
const AdmissionSchema = z.object({
  AGENT_GUEST_TURNS_PER_15_MIN: z.coerce.number().int().min(1).max(10_000),
  AGENT_MAX_ACTIVE_RUNS: z.coerce.number().int().min(1).max(1_000),
});

export function decodeAdmissionLimits(env: unknown): AdmissionLimits {
  const parsed = AdmissionSchema.safeParse(env);
  if (!parsed.success) throw new ConfigError(variablesOf(parsed.error));
  return {
    guestTurns: parsed.data.AGENT_GUEST_TURNS_PER_15_MIN,
    guestWindowMs: GUEST_WINDOW_MS,
    activeRuns: parsed.data.AGENT_MAX_ACTIVE_RUNS,
  };
}

const ExecutionSchema = z.object({
  ENABLED_WRITE_ADAPTERS: z.string().default(''),
  ONE_CLICK_JWT: optional(z.string().min(1)),
  NEAR_RPC_URL: optional(z.url()),
});

export interface ExecutionConfig extends Config {
  /** Adapters allowed to submit; each stays off until its lifecycle is validated on this network. */
  writeAdapters: ReadonlySet<string>;
  /** A 1Click partner JWT; quotes work without one and carry the default protocol fee. */
  oneClickJwt: string | null;
  /** A NEAR RPC for reads: `NEAR_RPC_URL`, or this network's public default. */
  rpcUrl: string;
}

export function decodeExecutionConfig(env: unknown): ExecutionConfig {
  const base = decodeConfig(env);
  const parsed = ExecutionSchema.safeParse(env);
  if (!parsed.success) throw new ConfigError(variablesOf(parsed.error));
  const data = parsed.data;
  return {
    ...base,
    writeAdapters: new Set(
      data.ENABLED_WRITE_ADAPTERS.split(',')
        .map((name) => name.trim())
        .filter(Boolean),
    ),
    oneClickJwt: data.ONE_CLICK_JWT ?? null,
    rpcUrl: data.NEAR_RPC_URL ?? NEAR_NETWORK_INFO[base.network].rpcUrl,
  };
}

/** The configured model, or the scripted one when no provider key is set. */
export function decodeAgentConfig(env: unknown): AgentConfig {
  const parsed = AgentConfigSchema.safeParse(env);
  if (!parsed.success) throw new ConfigError(variablesOf(parsed.error));
  const data = parsed.data;
  if (data.PI_PROVIDER === 'faux') return { provider: 'faux', script: data.PI_FAUX_SCRIPT };
  const apiKey = data.PI_PROVIDER === 'nearai' ? data.NEAR_AI_API_KEY : data.OPENROUTER_API_KEY;
  if (!apiKey) return { provider: 'faux', script: KEYLESS_FAUX_SCRIPT };
  return { provider: data.PI_PROVIDER, modelId: data.PI_MODEL_ID, apiKey };
}

function variablesOf(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((issue) => String(issue.path[0] ?? '(root)')))];
}

function parseJsonText(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
