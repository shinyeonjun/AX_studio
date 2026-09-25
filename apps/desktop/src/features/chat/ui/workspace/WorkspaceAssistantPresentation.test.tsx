import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkspaceAssistantPresentation } from './WorkspaceAssistantPresentation.js';

describe('WorkspaceAssistantPresentation', () => {
  it('renders command inputs as one batch submission', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceAssistantPresentation
        inputRequests={[
          { id: 'to', label: '수신자', type: 'email', required: true },
          { id: 'body', label: '본문', type: 'text', required: true },
        ]}
        busy={false}
        interactive
        onSend={async () => undefined}
      />,
    );

    expect(markup).toContain('수신자');
    expect(markup).toContain('본문');
    expect(markup).toContain('입력값으로 계속');
    expect(markup).not.toContain('>입력</button>');
  });
});
