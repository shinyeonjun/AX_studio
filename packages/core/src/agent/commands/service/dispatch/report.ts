import type { AxCommand, AxCommandResult } from '../../schema.js';
import { issue, result, textArg } from '../../contract.js';
import type { AxCommandExecuteOptions, AxCommandServiceState } from '../contracts.js';

export async function executeReportCommand(
  state: AxCommandServiceState,
  command: AxCommand,
  options: AxCommandExecuteOptions,
): Promise<AxCommandResult> {
  const goal = textArg(command, 'goal');
  const templateSourceId = textArg(command, 'templateSourceId');
  const exampleSourceId = textArg(command, 'exampleSourceId');
  const resumeExecutionId = textArg(command, 'resumeExecutionId');
  if (!options.workspaceSessionId) {
    return result(command.name, 'invalid', undefined, [issue('workspace_session_required', '현재 대화 세션이 필요합니다.')]);
  }
  const missing = [
    !goal ? 'goal' : undefined,
    !templateSourceId ? 'templateSourceId' : undefined,
    !exampleSourceId ? 'exampleSourceId' : undefined,
  ].filter((value): value is string => Boolean(value));
  if (missing.length > 0) {
    return result(command.name, 'needs_input', undefined, [issue(
      'report_sources_required',
      '빈 PDF 양식과 완성된 PDF 예시를 현재 대화 자료에서 선택해야 합니다.',
      undefined,
      { missing },
    )]);
  }
  if (templateSourceId === exampleSourceId) {
    return result(command.name, 'invalid', undefined, [issue('report_sources_must_differ', '빈 양식과 완성 예시는 서로 다른 자료여야 합니다.')]);
  }
  const workspaceSources = state.options.workspaceSources;
  if (!workspaceSources) {
    return result(command.name, 'error', undefined, [issue('workspace_sources_unavailable', '대화 자료 저장소가 연결되지 않았습니다.')]);
  }
  const sources = workspaceSources.list(options.workspaceSessionId);
  for (const [role, sourceId] of [['template', templateSourceId], ['example', exampleSourceId]] as const) {
    const source = sources.find((candidate) => candidate.id === sourceId);
    if (!source) return result(command.name, 'not_found', undefined, [issue(`report_${role}_not_found`, '선택한 자료를 현재 대화에서 찾을 수 없습니다.')]);
    if (source.status === 'processing') return result(command.name, 'needs_input', undefined, [issue('workspace_source_processing', 'PDF 분석이 끝날 때까지 잠시 기다려 주세요.')]);
    if (source.status !== 'ready') return result(command.name, 'error', undefined, [issue(source.errorCode ?? 'workspace_source_failed', 'PDF 자료 분석에 실패했습니다.')]);
    if (!source.fileName.toLowerCase().endsWith('.pdf')) return result(command.name, 'invalid', undefined, [issue(`report_${role}_pdf_required`, '보고서 양식과 예시는 PDF여야 합니다.')]);
  }

  const delegated: AxCommand = {
    name: 'execution.enqueue_once',
    args: {
      name: '예시 기반 PDF 보고서 생성',
      goal,
      success: '완성 예시의 계산 기준이 재현 검증되고 다음 기간 PDF가 생성됨',
      assumptions: ['외부 전송과 원본 데이터 변경 없음', '예시 재현 실패 시 결과물 생성 중단'],
      steps: [{
        type: 'action',
        id: 'generate_report',
        connector: 'document',
        action: 'pdf.report.generate',
        actionRef: 'document.pdf.report.generate',
        params: { goal, templateSourceId, exampleSourceId, ...(resumeExecutionId ? { resumeExecutionId } : {}) },
      }],
    },
  };
  return result(command.name, ...await state.workflowGateway.enqueueOnce(delegated, {
    workspaceSessionId: options.workspaceSessionId,
  }));
}
