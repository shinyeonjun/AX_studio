import { getCapability } from '../../../../../../catalog/data.js';
import type { AxCommand } from '../../../schema.js';
import type { CommandChatLoopContext } from '../turn-context.js';

/** After this long, a request still being understood says so instead of looking stuck. */
export const ROUTE_SLOW_NOTICE_MS = 8_000;

type Progress = CommandChatLoopContext['options']['onProgress'];

/** "요청을 확인하고 있어요", then a "longer than usual" note if it takes a while. Returns the stop. */
export function routeProgress(onProgress: Progress): () => void {
  onProgress?.({ message: '요청을 확인하고 있어요.' });
  const slow = setTimeout(() => {
    // A turn that ended meanwhile may refuse the update; there is nothing left to tell.
    try { onProgress?.({ message: '요청을 확인하는 데 평소보다 오래 걸리고 있어요. 조금만 기다려 주세요.' }); } catch { /* turn over */ }
  }, ROUTE_SLOW_NOTICE_MS);
  return () => clearTimeout(slow);
}

/** What the screen says while a chosen read runs: "가져오고 있어요: Slack 채널 읽기". */
export function readProgressMessage(command: AxCommand): string | undefined {
  if (command.name !== 'capability.invoke' || typeof command.args.id !== 'string') return undefined;
  const capability = getCapability(command.args.id);
  return capability?.kind === 'read' ? `가져오고 있어요: ${capability.label}` : undefined;
}
