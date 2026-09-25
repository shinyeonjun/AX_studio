import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxCore } from '../../core-instance.js';
import { buildConnectorState } from './connector-state.js';
import { buildAppState } from './build-state.js';

vi.mock('./connector-state.js', () => ({
  buildConnectorState: vi.fn(),
}));

describe('buildAppState', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts connector I/O before building database-backed summaries', async () => {
    let resolveConnectorState!: (value: Awaited<ReturnType<typeof buildConnectorState>>) => void;
    const connectorStatePromise = new Promise<Awaited<ReturnType<typeof buildConnectorState>>>((resolve) => {
      resolveConnectorState = resolve;
    });
    vi.mocked(buildConnectorState).mockReturnValue(connectorStatePromise);

    const store = {
      getPendingApprovalsWithExecutionSnapshots: vi.fn(() => []),
      listExecutions: vi.fn(() => []),
      listWorkflowDefinitions: vi.fn(() => []),
      getGlobalActive: vi.fn(() => false),
    };

    const statePromise = buildAppState({ store } as unknown as AxCore);

    expect(buildConnectorState).toHaveBeenCalledOnce();
    expect(store.getPendingApprovalsWithExecutionSnapshots).toHaveBeenCalledOnce();
    expect(store.listExecutions).toHaveBeenCalledOnce();
    expect(store.listWorkflowDefinitions).toHaveBeenCalledOnce();

    resolveConnectorState({} as Awaited<ReturnType<typeof buildConnectorState>>);
    await expect(statePromise).resolves.toMatchObject({ globalActive: false, works: [], approvals: [], executions: [] });
  });
});
