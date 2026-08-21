import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
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

  render() {
    if (this.state.error) {
      return (
        <div className="ui-error-fallback">
          <h1>화면을 표시하지 못했습니다</h1>
          <p className="muted">인터뷰 응답을 처리하는 중 오류가 발생했습니다. 앱을 다시 시작하거나 DevTools 콘솔을 확인해 주세요.</p>
          <pre className="ui-error-message">{this.state.error.message}</pre>
          <button type="button" className="btn btn-primary" onClick={() => this.setState({ error: null })}>
            다시 시도
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
