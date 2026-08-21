export const KO = {
  work: {
    defaultName: '새 업무',
  },
  execution: {
    noRecentRuns: '최근 실행 기록이 없습니다.',
    failedAt: (startedAt: string) => `${startedAt}에 실행이 중단되었습니다.`,
    cause: (message: string) => `원인: ${message}`,
    detail: (detail: string) => `상세: ${detail}`,
    recommendedAction: '권장 조치: 연결 상태와 워크플로우 활성화를 확인하세요.',
    statusAt: (startedAt: string, status: string) => `${startedAt} 실행은 ${status} 상태입니다.`,
    recent: (startedAt: string, status: string, errorCode?: string | null) =>
      `최근 실행: ${startedAt}, 상태: ${status}${errorCode ? `, 코드: ${errorCode}` : ''}`,
    errorMessages: {
      oauth_refresh_failed: 'Google OAuth 토큰이 만료되었습니다. Gmail을 다시 연결하세요.',
      file_not_found: '필요한 파일을 찾지 못했습니다. 경로를 확인하세요.',
      connector_missing: '필요한 연결이 없습니다. 설정에서 연결을 확인하세요.',
      global_off_duty: '전역 퇴근 상태여서 실행하지 않았습니다.',
      workflow_paused: '이 워크플로우가 비활성화되어 있습니다.',
      pending_approval: '사람 승인 대기 중입니다.',
    } as Record<string, string>,
  },
  revision: {
    fallbackProposal: (goal: string | undefined, instruction: string) =>
      `현재 목적: ${goal ?? ''}\n수정 지시: ${instruction}`,
  },
  requiredness: {
    goal: { label: '지시 의도', question: '이 업무의 목적을 한 문장으로 말해주세요.' },
    trigger: { label: '트리거', question: '언제 이 업무를 실행할까요? (예: 새 메일, 매주 금요일)' },
    'trigger.schedule': { label: '스케줄', question: '실행 스케줄을 알려주세요.' },
    'trigger.timezone': { label: '타임존', question: '시간대는 어디로 할까요?' },
    'trigger.runAt': { label: '예약 시각', question: '언제 한 번 실행할까요?' },
    action: { label: '실행 액션', question: '실행할 작업을 설명해주세요.' },
    approval: { label: '승인', question: '누구의 승인이 필요한가요? 어떤 조건에서 승인할까요?' },
    completion: { label: '완료 조건', question: '업무가 완료되었다고 볼 조건은 무엇인가요?' },
    'ai_decision.goal': { label: 'AI 판단 목적', question: '이 AI 단계는 무엇을 판단하거나 분류할까요?' },
    'ai_decision.schema': { label: 'AI 출력 스키마', question: 'AI가 어떤 형태로 결과를 내야 할까요?' },
    'human_approval.reason': { label: '승인 사유', question: '사람에게 어떤 작업을 승인받을까요?' },
  },
  chatSummary: {
    triggerManual: '지금 한 번 (저장하지 않음)',
    triggerOnce: '예약 1회',
  },
  workflowDocument: {
    triggerManual: '수동 실행',
    triggerSchedule: (schedule: string, timezone: string) => `스케줄: ${schedule} (${timezone})`,
    triggerGmail: (accountId: string) => `Gmail 새 메일: ${accountId}`,
    triggerSlack: (channel: string) => `Slack 새 메시지: ${channel}`,
    triggerOnce: (runAt: string) => `1회 예약: ${runAt}`,
    sectionWorkflow: '워크플로우',
    sectionCompletion: '완료 조건',
    sectionAssumptions: '가정',
    noSteps: '(노드 없음)',
  },
} as const;

export type RequirementQuestionKey = keyof typeof KO.requiredness;

export function requirementCopy(key: RequirementQuestionKey): { label: string; question: string } {
  return KO.requiredness[key];
}
