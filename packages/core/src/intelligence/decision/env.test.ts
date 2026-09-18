import { describe, expect, it } from 'vitest';
import { createExperimentalJevDecisionEngineFromEnvironment } from './env.js';
import { JevDecisionEngine } from './jev.js';

describe('createExperimentalJevDecisionEngineFromEnvironment', () => {
  it('is disabled unless the experiment flag is explicitly enabled', () => {
    expect(createExperimentalJevDecisionEngineFromEnvironment({
      TYPESAFE_API_KEY: 'test-key',
    })).toBeUndefined();
  });

  it('requires a TypeSafe API key when enabled', () => {
    expect(() => createExperimentalJevDecisionEngineFromEnvironment({
      AX_EXPERIMENT_JEV_DECISION_PLANE: '1',
    })).toThrow('requires TYPESAFE_API_KEY');
  });

  it('creates a Jev decision engine with the official environment contract', () => {
    const engine = createExperimentalJevDecisionEngineFromEnvironment({
      AX_EXPERIMENT_JEV_DECISION_PLANE: '1',
      TYPESAFE_API_KEY: 'test-key',
      TYPESAFE_BASE_URL: 'https://typesafe.example',
      TYPESAFE_DEFAULT_MODEL: 'jev-latest',
    });

    expect(engine).toBeInstanceOf(JevDecisionEngine);
  });
});
