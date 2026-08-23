import { useState } from 'react';
import type { AppState } from '../../../types/app-state';
import { ConnectionGuide } from '../ConnectionGuide';

const DEFAULT_TOOLS_JSON = `[
  {
    "name": "echo",
    "description": "Echo tool for smoke tests",
    "sideEffect": "NONE"
  }
]`;

interface McpConnectionFormProps {
  state: AppState | null;
  embedded?: boolean;
  onConnect: (payload: { serverId: string; label?: string; toolsJson: string }) => Promise<void>;
  onDisconnect: () => Promise<void>;
}

export function McpConnectionForm({ state, embedded = false, onConnect, onDisconnect }: McpConnectionFormProps) {
  const connected = Boolean(state?.connections?.find((entry) => entry.connector === 'mcp')?.connected);
  const [serverId, setServerId] = useState('local');
  const [label, setLabel] = useState('');
  const [toolsJson, setToolsJson] = useState(DEFAULT_TOOLS_JSON);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const handleConnect = async () => {
    setBusy(true);
    setMessage('');
    try {
      await onConnect({
        serverId,
        label: label.trim() || undefined,
        toolsJson,
      });
      setMessage('MCP 서버가 연결되었습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'MCP 연결에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    setMessage('');
    try {
      await onDisconnect();
      setMessage('MCP 연결이 해제되었습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '연결 해제에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={embedded ? 'connection-form connection-form--embedded' : 'connection-form'}>
      {!embedded && (
        <ConnectionGuide
          title="MCP 연결"
          steps={[
            'server ID를 지정합니다.',
            'tools JSON 배열에 MCP tool 정의를 입력합니다.',
            'v1은 MockMcpClient로 tool capability를 등록합니다.',
          ]}
        />
      )}

      <label className="field">
        <span>Server ID</span>
        <input value={serverId} onChange={(event) => setServerId(event.target.value)} />
      </label>

      <label className="field">
        <span>표시 이름 (선택)</span>
        <input value={label} onChange={(event) => setLabel(event.target.value)} />
      </label>

      <label className="field">
        <span>Tools JSON</span>
        <textarea value={toolsJson} onChange={(event) => setToolsJson(event.target.value)} rows={10} />
      </label>

      <div className="connection-actions">
        <button type="button" className="btn-primary" onClick={() => void handleConnect()} disabled={busy || connected}>
          연결
        </button>
        <button type="button" className="btn-secondary" onClick={() => void handleDisconnect()} disabled={busy || !connected}>
          연결 해제
        </button>
      </div>

      {message && <p className="form-message">{message}</p>}
    </div>
  );
}
