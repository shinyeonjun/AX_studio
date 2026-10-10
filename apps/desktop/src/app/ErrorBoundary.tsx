import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * `app` replaces the whole window and is the last resort. `section` keeps the rest of the app
   * (sidebar, tabs, other panels) working and shows the failure only where it happened.
   */
  scope?: 'app' | 'section';
  /** What failed, in the section message ("업무 구성", "이 화면"). */
  label?: string;
  /** A section starts over when this changes, e.g. when the person opens another chat or tab. */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[AX Studio UI]', error, info.componentStack);
  }

  componentDidUpdate(previous: ErrorBoundaryProps): void {
    if (this.state.error && !Object.is(previous.resetKey, this.props.resetKey)) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const retry = () => this.setState({ error: null });
    if (this.props.scope === 'section') {
      return (
        <div className="ui-error-section" role="alert">
          <strong>{this.props.label ?? '이 화면'}을 표시하지 못했어요</strong>
          <p className="muted">저장된 내용 일부를 읽지 못했어요. 다른 화면은 그대로 쓸 수 있어요.</p>
          <pre className="ui-error-message">{error.message}</pre>
          <button type="button" className="btn btn-secondary btn-sm" onClick={retry}>다시 시도</button>
        </div>
      );
    }
    return (
      <div className="ui-error-fallback">
        <h1>화면을 표시하지 못했습니다</h1>
        <p className="muted">화면을 그리는 중 오류가 발생했습니다. 다시 시도하거나 앱을 재시작해 주세요.</p>
        <pre className="ui-error-message">{error.message}</pre>
        <button type="button" className="btn btn-primary" onClick={retry}>
          다시 시도
        </button>
      </div>
    );
  }
}
