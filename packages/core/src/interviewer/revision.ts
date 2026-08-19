import type { SkillStore } from '../store/skill-store.js';

export function explainExecution(store: SkillStore, question: string): string {
  const executions = store.listExecutions(20);
  const latest = executions[0];
  if (!latest) return '최근 실행 기록이 없습니다.';

  const q = question.toLowerCase();
  if (q.includes('왜') || q.includes('안') || q.includes('실패')) {
    if (latest.status === 'failed' || latest.errorCode) {
      const code = latest.errorCode ?? 'unknown';
      const messages: Record<string, string> = {
        oauth_refresh_failed: 'Google OAuth 토큰이 만료되었습니다. Gmail을 다시 연결하세요.',
        file_not_found: '필요한 파일을 찾지 못했습니다. 경로를 확인하세요.',
        connector_missing: '필요한 연결이 없습니다. 설정에서 연결을 확인하세요.',
        global_off_duty: '전역 퇴근 상태여서 실행하지 않았습니다.',
        skill_paused: '이 Skill이 비활성화되어 있습니다.',
        pending_approval: '사람 승인 대기 중입니다.',
      };
      const log = JSON.parse(latest.logJson ?? '[]') as Array<{ level?: string; message?: string; code?: string }>;
      const detail = log.find((l) => l.level === 'error')?.message;
      return [
        `${latest.startedAt}에 실행이 중단되었습니다.`,
        `원인: ${messages[code] ?? code}`,
        detail ? `상세: ${detail}` : '',
        '권장 조치: 연결 상태와 Skill 활성화를 확인하세요.',
      ].filter(Boolean).join('\n');
    }
    return `${latest.startedAt} 실행은 ${latest.status} 상태입니다.`;
  }

  return `최근 실행: ${latest.startedAt}, 상태: ${latest.status}${latest.errorCode ? `, 코드: ${latest.errorCode}` : ''}`;
}

export function proposeSkillRevision(
  current: { goal?: string },
  instruction: string,
): { proposal: string; changes: string[] } {
  const changes: string[] = [];
  if (instruction.includes('10%')) changes.push('경고 임계값: 20% → 10%');
  if (instruction.includes('중지') || instruction.includes('쉬')) changes.push('Skill 비활성화');
  if (instruction.includes('매달') || instruction.includes('매주')) changes.push('스케줄 trigger 추가');
  return {
    proposal: `현재 목적: ${current.goal ?? ''}\n수정 지시: ${instruction}`,
    changes,
  };
}
