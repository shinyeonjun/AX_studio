import { useEffect, useState } from 'react';
import type { ExecutionOutput } from '@ax-studio/core';

/** Result bodies are requested only on demand, never broadcast with application state. */
export function CalculatedOutput({ executionId }: { executionId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [output, setOutput] = useState<ExecutionOutput>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!attempt) return;
    let current = true;
    setLoading(true);
    setError('');
    void window.ax.getExecutionOutput(executionId).then(result => {
      if (current) setOutput(result);
    }).catch((reason: unknown) => {
      if (current) setError(reason instanceof Error ? reason.message : '계산 결과를 불러오지 못했습니다.');
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [attempt, executionId]);

  return <section className="timeline-calculated-output" aria-label="계산 결과" aria-busy={loading}>
    {output ? <>
      <strong>계산 결과</strong>
      {output.fields.map((field, index) => <details key={`${field.path}-${index}`} open>
        <summary>{field.label ?? field.path}</summary>
        <pre>{field.valueJson}</pre>
      </details>)}
    </> : <>
      <button type="button" className="btn btn-sm btn-secondary" disabled={loading}
        onClick={() => setAttempt(current => current + 1)}>
        {loading ? '계산 결과 불러오는 중…' : error ? '계산 결과 다시 불러오기' : '계산 결과 보기'}
      </button>
      {error && <p role="alert">{error}</p>}
    </>}
  </section>;
}
