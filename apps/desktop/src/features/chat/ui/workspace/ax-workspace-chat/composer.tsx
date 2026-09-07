import { ComposerPrimitive } from '@assistant-ui/react';
import { useRef } from 'react';

export interface WorkspaceComposerProps {
  busy: boolean;
  placeholder: string;
}

export function WorkspaceComposer({
  busy,
  placeholder,
}: WorkspaceComposerProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="ax-workspace-composer-shell">
      <div className="ax-workspace-composer-input-row">
        <ComposerPrimitive.Input ref={inputRef} placeholder={placeholder} disabled={busy} aria-label="메시지 입력" />
        <ComposerPrimitive.Send className="ax-workspace-send" disabled={busy}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M8.99992 16V6.41407L5.70696 9.70704C5.31643 10.0976 4.68342 10.0976 4.29289 9.70704C3.90237 9.31652 3.90237 8.6835 4.29289 8.29298L9.29289 3.29298C9.68342 2.90245 10.3164 2.90245 10.7069 3.29298L15.7069 8.29298C16.0975 9.31652 15.3164 10.0976 14.2929 9.70704L10.9999 6.41407V16C10.9999 16.5523 10.5522 17 9.99992 17C9.44764 17 8.99992 16.5523 8.99992 16Z" />
          </svg>
          <span className="ax-workspace-send-label">메시지 보내기</span>
        </ComposerPrimitive.Send>
      </div>
    </div>
  );
}
