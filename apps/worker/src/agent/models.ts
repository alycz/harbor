import type { StreamFn } from '@earendil-works/pi-agent-core';
import {
  type Api,
  createModels,
  createProvider,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type Model,
} from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';

import { type AgentConfig, ConfigError, type FauxStep } from '../config.ts';

// OpenRouter's free variants end in ":free"; "openrouter/free" routes among them.
const FREE_MODEL_ID = /(:free$)|(^openrouter\/free$)/;

const NEAR_AI_BASE_URL = 'https://cloud-api.near.ai/v1';
/**
 * NEAR AI Cloud models Harbor may run: verifiable, attested, tool-calling models served on NEAR AI's own
 * TEE fleet, checked against the live catalog on 2026-11-11. Third-party and "abliterated" models are left
 * out. Anything else is a configuration error, never a fallback.
 */
const NEAR_AI_TEE_MODELS = [
  'Qwen/Qwen3.8-27B',
  'Qwen/Qwen3.6-35B-A3B-FP8',
  'deepseek-ai/DeepSeek-V4.1-Flash-1017',
  'z-ai/glm-5.3-flash',
] as const;

export interface ModelSource {
  model: Model<Api>;
  streamFn: StreamFn;
  getApiKey?: (provider: string) => string | undefined;
}

export function createModelSource(config: AgentConfig): ModelSource {
  const models = createModels();
  if (config.provider === 'faux') {
    const faux = fauxProvider({ tokensPerSecond: 1_000_000 });
    models.setProvider(faux.provider);
    faux.setResponses(config.script.map(toFauxMessage));
    return { model: faux.getModel(), streamFn: models.streamSimple.bind(models) };
  }
  const { apiKey } = config;
  if (config.provider === 'nearai') {
    if (!(NEAR_AI_TEE_MODELS as readonly string[]).includes(config.modelId)) throw new ConfigError(['PI_MODEL_ID']);
    models.setProvider(nearAiProvider(config.modelId, apiKey));
    const model = models.getModel('nearai', config.modelId);
    if (!model) throw new ConfigError(['PI_MODEL_ID']);
    return {
      model,
      streamFn: models.streamSimple.bind(models),
      getApiKey: (provider) => (provider === 'nearai' ? apiKey : undefined),
    };
  }
  models.setProvider(openrouterProvider());
  const model = models.getModel('openrouter', config.modelId);
  // Harbor only runs free OpenRouter models: a paid or unknown model is a configuration error, never a fallback.
  if (!model || !isFreeModel(model)) throw new ConfigError(['PI_MODEL_ID']);
  return {
    model,
    streamFn: models.streamSimple.bind(models),
    getApiKey: (provider) => (provider === 'openrouter' ? apiKey : undefined),
  };
}

/** NEAR AI Cloud's OpenAI-compatible gateway with the one allowed model the server is configured for. */
function nearAiProvider(modelId: string, apiKey: string) {
  return createProvider<'openai-completions'>({
    id: 'nearai',
    name: 'NEAR AI Cloud',
    baseUrl: NEAR_AI_BASE_URL,
    auth: {
      apiKey: {
        name: 'NEAR AI Cloud API key',
        resolve: async () => ({ auth: { apiKey }, source: 'NEAR_AI_API_KEY' }),
      },
    },
    models: [
      {
        id: modelId,
        name: modelId,
        api: 'openai-completions',
        provider: 'nearai',
        baseUrl: NEAR_AI_BASE_URL,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        reasoning: false,
        contextWindow: 128_000,
        maxTokens: 4_096,
      },
    ],
    api: openAICompletionsApi(),
  });
}

function isFreeModel(model: Model<Api>): boolean {
  const { input, output, cacheRead, cacheWrite } = model.cost;
  return FREE_MODEL_ID.test(model.id) && input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0;
}

function toFauxMessage(step: FauxStep) {
  return 'text' in step
    ? fauxAssistantMessage([fauxText(step.text)])
    : fauxAssistantMessage([fauxToolCall(step.toolCall.name, step.toolCall.args)], { stopReason: 'toolUse' });
}
