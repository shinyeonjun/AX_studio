import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../../persistence/db.js';
import { WorkflowStore } from '../../../../../persistence/workflow-store.js';
import type { AxUiPresentation } from '../../schema.js';
import { AxCommandService } from '../../service.js';
import { MUTATION_CONFIRM_VALUES } from '../dispatch/mutation-confirmation.js';
import { commandChatContext, executeConfirmedMutation } from '../fixtures.js';

async function fixture() {
  const db = await createDatabaseAsync(':memory:');
  const store = new WorkflowStore(db);
  const runs: string[] = [];
  const service = new AxCommandService(store, {
    runWorkflow: async (workflowId) => { runs.push(workflowId); return { executionId: 'execution-1' }; },
  });
  const created = await service.execute({
    name: 'workflow.create',
    args: { name: '확인 테스트', goal: '확인 후에만 실행한다' },
  }, commandChatContext);
  const workflowId = (created.data as { workflowId: string }).workflowId;
  const options = { ...commandChatContext, workspaceSessionId: 'session-a', currentWorkflowId: workflowId };
  return { store, service, runs, workflowId, options };
}

function tokenOf(data: unknown): string {
  const action = (data as { presentation: AxUiPresentation }).presentation.actions[0]!;
  expect(action.purpose).toBe('confirm_mutation');
  return action.id.slice('confirm_mutation:'.length);
}

describe('agent workflow mutation confirmation', () => {
  it('proposes instead of deleting and renders an exact host confirmation card', async () => {
    const { store, service, workflowId, options } = await fixture();
    const proposed = await service.execute({ name: 'workflow.delete', args: { workflowId, baseVersion: 1 } }, options);

    expect(proposed).toMatchObject({ command: 'workflow.delete', status: 'needs_input', data: { confirmationRequired: true, pending: true } });
    const presentation = (proposed.data as { presentation: AxUiPresentation }).presentation;
    expect(presentation.title).toBe('이 업무를 삭제할까요?');
    expect(presentation.actions).toEqual([expect.objectContaining({
      tone: 'danger', purpose: 'confirm_mutation', value: MUTATION_CONFIRM_VALUES['workflow.delete'],
    })]);
    // People see the job's name, not internal ids or version numbers.
    const blocks = JSON.stringify(presentation.blocks);
    expect(blocks).toContain(store.getWorkflow(workflowId)!.name);
    expect(blocks).not.toContain(workflowId);
    expect(blocks).not.toMatch(/workflow|버전/u);
    expect(store.getWorkflow(workflowId)).toBeDefined();
  });

  it('executes the stored command exactly once for the right token and returns the underlying result', async () => {
    const { store, service, workflowId, options } = await fixture();
    const proposed = await service.execute({ name: 'workflow.delete', args: { workflowId, baseVersion: 1 } }, options);
    const token = tokenOf(proposed.data);

    const committed = await service.execute({ name: 'mutation.commit', args: {} }, { ...options, mutationConfirmationToken: token });
    expect(committed).toMatchObject({ command: 'workflow.delete', status: 'ok', data: { deleted: true, workflowId } });
    expect(store.getWorkflow(workflowId)).toBeNull();

    const replay = await service.execute({ name: 'mutation.commit', args: {} }, { ...options, mutationConfirmationToken: token });
    expect(replay).toMatchObject({ command: 'mutation.commit', status: 'not_found' });
  });

  it('tells apart jobs that share a name', async () => {
    const { store, service, workflowId, options } = await fixture();
    const twin = store.saveWorkflow({ ...store.getWorkflow(workflowId)!, id: undefined } as never);
    const proposed = await service.execute({ name: 'workflow.delete', args: { workflowId, baseVersion: 1 } }, options);
    const blocks = JSON.stringify((proposed.data as { presentation: AxUiPresentation }).presentation.blocks);
    expect(blocks).toContain(`#${workflowId.slice(0, 8)}`);
    expect(blocks).not.toContain(twin.workflowId.slice(0, 8));
  });

  it('refuses a wrong or missing token and keeps the workflow', async () => {
    const { store, service, runs, workflowId, options } = await fixture();
    await service.execute({ name: 'workflow.run', args: { workflowId } }, options);

    await expect(service.execute({ name: 'mutation.commit', args: {} }, options))
      .resolves.toMatchObject({ status: 'forbidden', issues: [{ code: 'mutation_commit_forbidden' }] });
    await expect(service.execute({ name: 'mutation.commit', args: {} }, { ...options, mutationConfirmationToken: 'forged' }))
      .resolves.toMatchObject({ status: 'forbidden', issues: [{ code: 'mutation_confirmation_mismatch' }] });
    expect(runs).toEqual([]);
    expect(store.getWorkflow(workflowId)).toBeDefined();
  });

  it('binds the pending mutation to the proposing session', async () => {
    const { service, runs, workflowId, options } = await fixture();
    const proposed = await service.execute({ name: 'workflow.run', args: { workflowId } }, options);
    const token = tokenOf(proposed.data);

    await expect(service.execute({ name: 'mutation.commit', args: {} }, {
      ...options, workspaceSessionId: 'session-b', mutationConfirmationToken: token,
    })).resolves.toMatchObject({ status: 'not_found' });
    expect(runs).toEqual([]);

    await expect(service.execute({ name: 'mutation.commit', args: {} }, { ...options, mutationConfirmationToken: token }))
      .resolves.toMatchObject({ command: 'workflow.run', status: 'ok' });
    expect(runs).toEqual([workflowId]);
  });

  it('refuses when the confirmed workflow is no longer the current workflow', async () => {
    const { service, runs, workflowId, options } = await fixture();
    const proposed = await service.execute({ name: 'workflow.run', args: { workflowId } }, options);
    const token = tokenOf(proposed.data);

    await expect(service.execute({ name: 'mutation.commit', args: {} }, {
      ...options, currentWorkflowId: 'other-workflow', mutationConfirmationToken: token,
    })).resolves.toMatchObject({ status: 'forbidden', issues: [{ code: 'workflow_target_mismatch' }] });
    expect(runs).toEqual([]);
  });

  it('does not issue a confirmation without a session or for an invalid change', async () => {
    const { service, workflowId, options } = await fixture();
    await expect(service.execute({ name: 'workflow.delete', args: { workflowId, baseVersion: 1 } }, {
      ...commandChatContext, currentWorkflowId: workflowId,
    })).resolves.toMatchObject({ status: 'forbidden', issues: [{ code: 'workspace_session_required' }] });
    await expect(service.execute({ name: 'workflow.update', args: {
      workflowId, baseVersion: 7, operations: [{ op: 'set', path: 'name', value: 'x' }],
    } }, options)).resolves.toMatchObject({ status: 'conflict' });
  });

  it('summarizes an update and does not persist it before confirmation', async () => {
    const { store, service, workflowId, options } = await fixture();
    const proposed = await service.execute({ name: 'workflow.update', args: {
      workflowId,
      baseVersion: 1,
      operations: [{ op: 'upsert_step', step: {
        type: 'action', id: 'notify', connector: 'slack', action: 'message.send', params: { channel: '#ops', text: 'hi' },
      } }],
    } }, options);

    expect(proposed.status).toBe('needs_input');
    const text = JSON.stringify((proposed.data as { presentation: AxUiPresentation }).presentation);
    expect(text).toMatch(/\[외부\] Slack 메시지/u);
    expect(text).toContain('채널 #ops');
    expect(text).toContain('새 단계 추가 (1단계): Slack 메시지');
    expect(text).not.toContain('notify');
    expect(store.getWorkflow(workflowId)?.version).toBe(1);
  });

  it('names changed steps by number and field label', async () => {
    const { store, service, workflowId, options } = await fixture();
    const added = await executeConfirmedMutation(service, { name: 'workflow.update', args: {
      workflowId, baseVersion: 1, operations: [{ op: 'upsert_step', step: {
        type: 'action', id: 'notify', connector: 'slack', action: 'message.send', params: { channel: '#ops', text: 'hi' },
      } }],
    } }, options);
    expect(added.status).toBe('ok');
    const version = store.getWorkflow(workflowId)!.version;

    const proposed = await service.execute({ name: 'workflow.update', args: {
      workflowId,
      baseVersion: version,
      operations: [
        { op: 'set', path: 'name', value: '새 이름' },
        { op: 'upsert_step', step: {
          type: 'action', id: 'notify', connector: 'slack', action: 'message.send', params: { channel: '#ops', text: 'bye' },
        } },
        { op: 'remove_step', stepId: 'notify' },
      ],
    } }, options);
    const changes = (proposed.data as { presentation: AxUiPresentation }).presentation.blocks
      .find((block) => block.type === 'steps' && block.title === '요청한 변경') as { items: string[] } | undefined;
    expect(changes?.items[0]).toBe('업무 이름 변경');
    expect(changes?.items[1]).toMatch(/^1단계 '.+' 변경$/u);
    expect(changes?.items[2]).toBe('1단계 삭제');
  });

  it('hides mutation.commit from the agent command catalog', () => {
    return fixture().then(({ service }) => {
      expect(service.listCommands(commandChatContext.executionContext).map(({ name }) => name)).not.toContain('mutation.commit');
    });
  });
});
