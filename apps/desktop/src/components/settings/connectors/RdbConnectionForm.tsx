import { useState } from 'react';
import type { AppState } from '../../../types/app-state';
import { ConnectionGuide } from '../ConnectionGuide';

interface RdbConnectionFormProps {
  state: AppState | null;
  embedded?: boolean;
  onPickSqliteFile: () => Promise<{ ok: boolean; canceled?: boolean; path?: string }>;
  onConnect: (payload: {
    type: 'postgres' | 'sqlite';
    connectionString?: string;
    filePath?: string;
    allowedTables?: string[];
    rowLimit?: number;
    label?: string;
  }) => Promise<void>;
  onDisconnect: () => Promise<void>;
}

export function RdbConnectionForm({
  state,
  embedded = false,
  onPickSqliteFile,
  onConnect,
  onDisconnect,
}: RdbConnectionFormProps) {
  const connected = Boolean(state?.connections?.find((entry) => entry.connector === 'rdb')?.connected);
  const [type, setType] = useState<'sqlite' | 'postgres'>('sqlite');
  const [filePath, setFilePath] = useState('');
  const [connectionString, setConnectionString] = useState('');
  const [allowedTables, setAllowedTables] = useState('');
  const [rowLimit, setRowLimit] = useState('1000');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const handlePickFile = async () => {
    const result = await onPickSqliteFile();
    if (result.ok && result.path) setFilePath(result.path);
  };

  const handleConnect = async () => {
    setBusy(true);
    setMessage('');
    try {
      await onConnect({
        type,
        filePath: type === 'sqlite' ? filePath : undefined,
        connectionString: type === 'postgres' ? connectionString : undefined,
        allowedTables: allowedTables
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
        rowLimit: Number(rowLimit) || undefined,
        label: label.trim() || undefined,
      });
      setMessage('데이터베이스가 연결되었습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'DB 연결에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    setMessage('');
    try {
      await onDisconnect();
      setMessage('DB 연결이 해제되었습니다.');
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
          title="데이터베이스 연결"
          steps={[
            'SQLite 파일 또는 PostgreSQL connection string을 설정합니다.',
            '허용 테이블 목록을 쉼표로 구분해 입력합니다 (비우면 조회가 거부됩니다).',
            '읽기 전용 조회만 지원합니다.',
          ]}
        />
      )}

      <label className="field">
        <span>DB 유형</span>
        <select value={type} onChange={(event) => setType(event.target.value as 'sqlite' | 'postgres')}>
          <option value="sqlite">SQLite</option>
          <option value="postgres">PostgreSQL</option>
        </select>
      </label>

      {type === 'sqlite' ? (
        <label className="field">
          <span>SQLite 파일</span>
          <div className="field-row">
            <input value={filePath} onChange={(event) => setFilePath(event.target.value)} placeholder="C:\\data\\app.db" />
            <button type="button" className="btn-secondary" onClick={() => void handlePickFile()} disabled={busy}>
              찾아보기
            </button>
          </div>
        </label>
      ) : (
        <label className="field">
          <span>Connection string</span>
          <input
            value={connectionString}
            onChange={(event) => setConnectionString(event.target.value)}
            placeholder="postgresql://user:pass@localhost:5432/db"
          />
        </label>
      )}

      <label className="field">
        <span>허용 테이블 (쉼표 구분)</span>
        <input value={allowedTables} onChange={(event) => setAllowedTables(event.target.value)} placeholder="users, orders" />
      </label>

      <label className="field">
        <span>행 제한</span>
        <input value={rowLimit} onChange={(event) => setRowLimit(event.target.value)} inputMode="numeric" />
      </label>

      <label className="field">
        <span>표시 이름 (선택)</span>
        <input value={label} onChange={(event) => setLabel(event.target.value)} />
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
