import { Fragment } from 'react';
import { SLOT_LABELS } from '../../constants/interview-slots';
import { getInterviewStep } from '../../lib/interview';
import type { InterviewState } from '../../hooks/useInterview';
import { PageHeader } from '../layout/PageHeader';

const STEPS = [
  { n: 1, label: '지시하기' },
  { n: 2, label: '인터뷰' },
  { n: 3, label: '검토' },
  { n: 4, label: '완료' },
];

interface ChatPageProps {
  interview: InterviewState | null;
  saved: boolean;
  instruction: string;
  answer: string;
  onInstructionChange: (value: string) => void;
  onAnswerChange: (value: string) => void;
  onStartInterview: () => void;
  onSendAnswer: () => void;
  onTestRun: () => void;
  onSaveAndRun: () => void;
}

export function ChatPage({
  interview,
  saved,
  instruction,
  answer,
  onInstructionChange,
  onAnswerChange,
  onStartInterview,
  onSendAnswer,
  onTestRun,
  onSaveAndRun,
}: ChatPageProps) {
  const interviewStep = getInterviewStep(interview, saved);
  const checklistSlots = interview?.completeness?.slots ?? [];

  return (
    <>
      <PageHeader
        title="새 업무 지시"
        subtitle="직원에게 말하듯 지시하고, AI가 확인 질문을 합니다"
      />
      <div className="page-content page-content-fill">
        <div className="stepper">
          {STEPS.map((s, i, arr) => (
            <Fragment key={s.n}>
              <div
                className={`step ${interviewStep === s.n ? 'active' : ''} ${interviewStep > s.n ? 'done' : ''}`}
              >
                <span className="step-num">{interviewStep > s.n ? '✓' : s.n}</span>
                {s.label}
              </div>
              {i < arr.length - 1 && <div className="step-line" />}
            </Fragment>
          ))}
        </div>

        <div className="chat-layout">
          <div className="chat-panel">
            <div className="chat-messages">
              {!interview && (
                <div className="message assistant">
                  오늘 무엇을 맡길까요? 예: &quot;고객 문의 메일을 분류하고 중요한 건 슬랙으로 알려줘&quot;
                </div>
              )}
              {interview?.messages?.map((m, i) => (
                <div key={i} className={`message ${m.role}`}>{m.content}</div>
              ))}
              {interview?.done && interview.summary && (
                <div className="message assistant">
                  <strong>업무 요약</strong>
                  <div className="review-box">{interview.summary}</div>
                </div>
              )}
            </div>
            <div className="chat-input-area">
              {!interview ? (
                <>
                  <textarea
                    rows={2}
                    placeholder="업무를 자연어로 지시하세요..."
                    value={instruction}
                    onChange={(e) => onInstructionChange(e.target.value)}
                  />
                  <button type="button" className="btn btn-primary" onClick={onStartInterview}>
                    업무 지시
                  </button>
                </>
              ) : !interview.done ? (
                <>
                  <textarea
                    rows={2}
                    placeholder="답변을 입력하세요..."
                    value={answer}
                    onChange={(e) => onAnswerChange(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), onSendAnswer())}
                  />
                  <button type="button" className="btn btn-primary" onClick={onSendAnswer}>
                    답하기
                  </button>
                </>
              ) : (
                <div className="action-row">
                  <button type="button" className="btn" onClick={onTestRun}>테스트 실행</button>
                  <button type="button" className="btn btn-primary" onClick={onSaveAndRun}>
                    이대로 맡기기
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="progress-panel">
            <h3 className="progress-title">진행 상황</h3>
            {checklistSlots.length > 0 ? (
              <ul className="checklist">
                {checklistSlots.map((slot) => (
                  <li key={slot.slot} className={`check-item ${slot.filled ? 'done' : ''}`}>
                    <span className="check-icon">{slot.filled ? '✓' : ''}</span>
                    {SLOT_LABELS[slot.slot] ?? slot.slot}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">업무를 지시하면 필요한 항목이 여기 표시됩니다</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
