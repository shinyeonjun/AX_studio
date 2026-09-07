import { ConnectionGuide } from '../ConnectionGuide';
import { ConnectedServiceList } from '../ConnectedServiceList';
import type { RdbConnectionFormProps, RdbConnectionType } from './rdb-connection/use-rdb-connection-form';
import { useRdbConnectionForm } from './rdb-connection/use-rdb-connection-form';

export function RdbConnectionForm({
  state,
  embedded = false,
  onPickSqliteFile,
  onConnect,
  onDisconnect,
}: RdbConnectionFormProps) {
  const {
    formRef,
    connected,
    type,
    setType,
    filePath,
    setFilePath,
    connectionString,
    setConnectionString,
    allowedSchemas,
    setAllowedSchemas,
    allowedTables,
    setAllowedTables,
    rowLimit,
    setRowLimit,
    label,
    setLabel,
    busy,
    message,
    connectedItems,
    loadFromConnection,
    handlePickFile,
    handleConnect,
    handleDisconnect,
  } = useRdbConnectionForm({ state, onPickSqliteFile, onConnect, onDisconnect });

  return (
    <div ref={formRef} className={embedded ? 'connection-form connection-form--embedded' : 'connection-form'}>
      {!embedded && (
        <ConnectionGuide
          title="데이터베이스 연결"
          steps={[
            'SQLite 파일 또는 PostgreSQL/MySQL connection string을 설정합니다.',
            '허용 테이블 목록을 쉼표로 구분해 입력합니다 (비우면 조회가 거부됩니다).',
            'PostgreSQL/MySQL은 connection string을 OS 보안 저장소에 보관합니다.',
            'PostgreSQL: postgresql://user:pass@host:5432/db · MySQL: mysql://user:pass@host:3306/db',
          ]}
        />
      )}

      <label className="field">
        <span>DB 유형</span>
        <select value={type} onChange={(event) => setType(event.target.value as RdbConnectionType)}>
          <option value="sqlite">SQLite</option>
          <option value="postgres">PostgreSQL</option>
          <option value="mysql">MySQL</option>
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
            placeholder={
              connected
                ? '변경 시에만 입력'
                : type === 'mysql'
                  ? 'mysql://user:pass@localhost:3306/db'
                  : 'postgresql://user:pass@localhost:5432/db'
            }
          />
        </label>
      )}

      {type !== 'sqlite' && (
        <label className="field">
          <span>허용 스키마 (쉼표 구분, 선택)</span>
          <input
            value={allowedSchemas}
            onChange={(event) => setAllowedSchemas(event.target.value)}
            placeholder={type === 'mysql' ? 'ax_test' : 'public'}
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
        <button type="button" className="btn-primary" onClick={() => void handleConnect()} disabled={busy}>
          {connected ? '다시 연결' : '연결'}
        </button>
        {connected && (
          <button type="button" className="btn-secondary" onClick={() => void handleDisconnect()} disabled={busy}>
            연결 해제
          </button>
        )}
      </div>

      {message && <p className="form-message">{message}</p>}

      <ConnectedServiceList
        title="연결된 데이터베이스"
        items={connectedItems}
        busy={busy}
        onEdit={() => loadFromConnection()}
        onDisconnect={() => void handleDisconnect()}
      />
    </div>
  );
}
