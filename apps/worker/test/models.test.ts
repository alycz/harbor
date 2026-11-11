import { describe, expect, it } from 'vitest';
import { createModelSource } from '../src/agent/models.ts';
import { ConfigError } from '../src/config.ts';

const KEY = 'test-placeholder';

describe('createModelSource', () => {
  it('accepts free OpenRouter models', () => {
    for (const modelId of ['thinkingmachines/inkling:free', 'openrouter/free']) {
      expect(createModelSource({ provider: 'openrouter', modelId, apiKey: KEY }).model.id).toBe(modelId);
    }
  });

  it('refuses paid and unknown models instead of falling back', () => {
    for (const modelId of ['anthropic/claude-sonnet-5.5', 'thinkingmachines/inkling', 'nope/not-a-model:free']) {
      expect(() => createModelSource({ provider: 'openrouter', modelId, apiKey: KEY })).toThrow(ConfigError);
    }
  });

  it('runs only attested NEAR AI Cloud models from its own TEE fleet, through its gateway', () => {
    const source = createModelSource({ provider: 'nearai', modelId: 'Qwen/Qwen3.8-27B', apiKey: KEY });
    expect(source.model).toMatchObject({
      id: 'Qwen/Qwen3.8-27B',
      provider: 'nearai',
      api: 'openai-completions',
      baseUrl: 'https://cloud-api.near.ai/v1',
    });
    expect(source.getApiKey?.('nearai')).toBe(KEY);
    expect(source.getApiKey?.('openrouter')).toBeUndefined();
    for (const modelId of ['anthropic/claude-fable-5', 'Qwen/Qwen3.8-27B-abliterated', 'moonshotai/kimi-k3']) {
      expect(() => createModelSource({ provider: 'nearai', modelId, apiKey: KEY })).toThrow(ConfigError);
    }
  });
});
