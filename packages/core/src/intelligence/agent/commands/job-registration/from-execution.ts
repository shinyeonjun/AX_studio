import { decodeScheduleInputValue } from '../../../../workflow/schedule/input-value.js';
import { describeRecurrence } from '../../../../workflow/schedule/describe.js';
import { parseWorkflowIR } from '../../../../workflow/schema.js';

/** The parts of a stored execution this conversion reads. */
export interface ExecutionForRecurrence {
  ephemeral: boolean;
  status: string;
  workspaceSessionId?: string;
  irJson?: string;
}

export type RecurringJobFromExecution =
  | { ok: true; args: Record<string, unknown>; scheduleText: string }
  | { ok: false; message: string };

/**
 * `job.propose` arguments that repeat a one-off run of this conversation on a schedule.
 *
 * The steps are the ones that actually ran, unchanged, so the recurring job does exactly what the
 * person just saw; nothing is re-planned. Only the start condition changes. The proposal still
 * goes through the confirmation card: nothing is saved or switched on here, and external sends
 * keep needing approval unless the person turns that on there.
 */
export function recurringJobFromExecution(input: {
  execution: ExecutionForRecurrence | undefined;
  workspaceSessionId: string;
  /** The schedule form's submitted value (plain description plus its machine token). */
  scheduleValue: string;
}): RecurringJobFromExecution {
  const { execution } = input;
  if (!execution || !execution.ephemeral || execution.workspaceSessionId !== input.workspaceSessionId) {
    return { ok: false, message: '이 대화에서 실행한 작업을 찾지 못했습니다.' };
  }
  if (execution.status !== 'success') {
    return { ok: false, message: '끝까지 성공한 실행만 반복 업무로 만들 수 있습니다.' };
  }
  const recurrence = decodeScheduleInputValue(input.scheduleValue);
  if (!recurrence) return { ok: false, message: '반복 일정을 다시 골라 주세요.' };
  let ir: ReturnType<typeof parseWorkflowIR>;
  try {
    ir = parseWorkflowIR(JSON.parse(execution.irJson ?? ''));
  } catch {
    return { ok: false, message: '실행 기록을 읽지 못해 반복 업무로 만들 수 없습니다. 같은 요청을 다시 실행한 뒤 시도해 주세요.' };
  }
  if (ir.steps.length === 0) return { ok: false, message: '반복할 단계가 없습니다.' };
  // A run started by an event (new mail, new file) already repeats; only one-off runs get a schedule.
  if (ir.trigger && ir.trigger.type !== 'manual' && ir.trigger.type !== 'once') {
    return { ok: false, message: '이 작업은 이미 시작 조건이 있는 업무입니다.' };
  }
  const scheduleText = describeRecurrence(recurrence);
  return {
    ok: true,
    scheduleText,
    args: {
      name: ir.name,
      goal: ir.goal,
      trigger: { type: 'schedule', recurrence, timezone: recurrence.timezone },
      steps: ir.steps,
      ...(ir.success ? { success: ir.success } : {}),
      // Saving only switches the schedule on; the first run happens at the first scheduled time.
      runOnceNow: false,
      allowExternalAuto: false,
    },
  };
}
