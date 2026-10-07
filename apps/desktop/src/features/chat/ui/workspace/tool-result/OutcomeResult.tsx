import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ToolSendOutcome } from '@ax-studio/core';
import { cachedToolDraftForExecution } from './draft-controller';
import { ToolHeader } from './ToolHeader';

const noDraftSubscription = () => () => undefined;
const noDraftSnapshot = () => undefined;

export function OutcomeResult({ outcome, refreshWarning, persistenceWarning, executionId }: { outcome: ToolSendOutcome; refreshWarning?: boolean; persistenceWarning?: boolean; executionId?: string }) {
  const controller = cachedToolDraftForExecution(executionId, outcome.binding.provider);
  const state = useSyncExternalStore(controller?.subscribe ?? noDraftSubscription, controller?.getSnapshot ?? noDraftSnapshot, controller?.getSnapshot ?? noDraftSnapshot);
  const tool = outcome.binding.provider;
  const [host, setHost] = useState<{ executionId: string; tool: typeof tool; refreshWarning?: boolean; persistenceWarning?: boolean; failed?: boolean }>();
  useEffect(() => {
    if (!executionId) return;
    let current = true;
    let sequence = 0;
    const load = async () => {
      const request = ++sequence;
      try {
        const evidence = await window.ax.getToolResult({ executionId });
        if (!current || request !== sequence) return;
        setHost({ executionId, tool, ...(evidence.executionId === executionId
          ? { refreshWarning: evidence.refreshWarning, persistenceWarning: evidence.persistenceWarning } : { failed: true }) });
      } catch {
        if (current && request === sequence) setHost({ executionId, tool, failed: true });
      }
    };
    void load();
    const stop = window.ax.onStateChanged(() => { void load(); });
    return () => { current = false; sequence++; stop(); };
  }, [executionId, tool]);
  const evidence = host && host.executionId === executionId && host.tool === tool ? host : undefined;
  const warning = refreshWarning || state?.refreshWarning || evidence?.refreshWarning;
  const persistenceFailed = persistenceWarning || state?.persistenceWarning || evidence?.persistenceWarning;
  const gmail = outcome.binding.provider === 'gmail';
  const sent = outcome.status === 'sent';
  return <section className="tool-result-pane" aria-label="전송 결과">
    <ToolHeader tool={outcome.binding.provider} title={gmail ? 'Gmail · 전송 결과' : 'Slack · 전송 결과'} badge={sent ? '전송 완료' : '결과 확인 필요'} />
    <p className="tool-result-destination"><span>{outcome.binding.workspaceLabel ? outcome.binding.workspaceLabel + ' · ' + outcome.binding.accountLabel : outcome.binding.accountLabel}</span><strong>{outcome.binding.destinationLabel}</strong></p>
    <p role="status">{sent ? '서비스에서 전송 완료를 확인했습니다.' : '전송 결과를 확인할 수 없습니다. 자동으로 다시 전송하지 않습니다. 서비스에서 결과를 확인해 주세요.'}</p>
    {sent && <p>서비스 확인 번호: {outcome.receiptId}</p>}
    {warning && <p role="status">{persistenceFailed ? '로컬 기록을 저장하지 못했습니다.' : '화면 기록을 새로 불러오지 못했습니다.'} 전송 결과는 유지됩니다. 다시 보내지 말고 서비스에서 결과를 확인해 주세요.</p>}
    {evidence?.failed && <p role="status">전송 기록의 경고 정보를 불러오지 못했습니다. 알려진 전송 결과는 유지됩니다. 서비스에서 확인해 주세요.</p>}
    <small>전송 본문은 이 결과에 저장되지 않았습니다. 서비스에서 확인해 주세요.</small>
  </section>;
}
