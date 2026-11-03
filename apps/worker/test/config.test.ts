import { describe, expect, it } from 'vitest';

import {
  ConfigError,
  decodeAgentConfig,
  decodeConfig,
  decodeExecutionConfig,
  KEYLESS_FAUX_SCRIPT,
} from '../src/config.ts';

describe('decodeConfig', () => {
  it('decodes the network and an explicit execution flag', () => {
    expect(decodeConfig({ NEAR_NETWORK: 'testnet', EXECUTION_ENABLED: 'false' })).toEqual({
      network: 'testnet',
      executionEnabled: false,
    });
  });

  it('names every invalid variable and never echoes a value', () => {
    let caught: unknown;
    try {
      decodeConfig({ NEAR_NETWORK: 'near-mainnet', EXECUTION_ENABLED: '1' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).variables).toEqual(['NEAR_NETWORK', 'EXECUTION_ENABLED']);
    expect((caught as ConfigError).message).not.toContain('near-mainnet');
  });

  it('refuses a missing execution flag instead of defaulting it', () => {
    expect(() => decodeConfig({ NEAR_NETWORK: 'mainnet' })).toThrow(ConfigError);
  });
});

describe('decodeAgentConfig', () => {
  it('uses OpenRouter when a model and key are set', () => {
    expect(
      decodeAgentConfig({
        PI_PROVIDER: 'openrouter',
        PI_MODEL_ID: 'openrouter/free',
        OPENROUTER_API_KEY: 'k',
      }),
    ).toEqual({ provider: 'openrouter', modelId: 'openrouter/free', apiKey: 'k' });
    expect(() => decodeAgentConfig({ PI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'k' })).toThrow(/PI_MODEL_ID/);
  });

  it('falls back to the scripted model when no key is set, so setup needs no keys', () => {
    for (const OPENROUTER_API_KEY of [undefined, '']) {
      expect(decodeAgentConfig({ PI_PROVIDER: 'openrouter', PI_MODEL_ID: 'm', OPENROUTER_API_KEY })).toEqual({
        provider: 'faux',
        script: KEYLESS_FAUX_SCRIPT,
      });
    }
  });

  it('refuses an unknown provider and an invalid faux script', () => {
    expect(() => decodeAgentConfig({ PI_PROVIDER: 'openai' })).toThrow(ConfigError);
    expect(() => decodeAgentConfig({ PI_PROVIDER: 'faux', PI_FAUX_SCRIPT: '[{"nope":1}]' })).toThrow(/PI_FAUX_SCRIPT/);
    expect(() => decodeAgentConfig({ PI_PROVIDER: 'faux', PI_FAUX_SCRIPT: 'not json' })).toThrow(/PI_FAUX_SCRIPT/);
  });

  it('takes a faux script as JSON text or as an already parsed array', () => {
    const script = [{ text: 'hello' }];
    expect(decodeAgentConfig({ PI_PROVIDER: 'faux', PI_FAUX_SCRIPT: JSON.stringify(script) })).toEqual({
      provider: 'faux',
      script,
    });
    expect(decodeAgentConfig({ PI_PROVIDER: 'faux', PI_FAUX_SCRIPT: script })).toEqual({ provider: 'faux', script });
  });
});

describe('decodeExecutionConfig', () => {
  it('keeps every write adapter off unless listed, and an empty JWT unset', () => {
    const base = { NEAR_NETWORK: 'mainnet', EXECUTION_ENABLED: 'false' };
    expect(decodeExecutionConfig({ ...base, ENABLED_WRITE_ADAPTERS: '', ONE_CLICK_JWT: '' })).toMatchObject({
      executionEnabled: false,
      oneClickJwt: null,
    });
    expect([...decodeExecutionConfig(base).writeAdapters]).toEqual([]);
    expect([...decodeExecutionConfig({ ...base, ENABLED_WRITE_ADAPTERS: ' oneclick, ' }).writeAdapters]).toEqual([
      'oneclick',
    ]);
  });
});
