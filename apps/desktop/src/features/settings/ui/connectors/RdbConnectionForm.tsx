import { useId } from 'react';
import { ConnectionGuide } from '../ConnectionGuide';
import { ConnectedServiceList } from '../ConnectedServiceList';
import { RdbTablePicker } from './rdb-connection/RdbTablePicker';
import type { RdbConnectionFormProps, RdbConnectionType } from './rdb-connection/use-rdb-connection-form';
import { useRdbConnectionForm } from './rdb-connection/use-rdb-connection-form';

export function RdbConnectionForm({
  state,
  embedded = false,
  onPickSqliteFile,
  onDiscoverTables,
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
    discovered,
    discoverTables,
    rowLimit,
    setRowLimit,
    label,
    setLabel,
    busy,
    message,
    warning,
    connectedItems,
    loadFromConnection,
    handlePickFile,
    handleConnect,
    handleDisconnect,
  } = useRdbConnectionForm({ state, onPickSqliteFile, onDiscoverTables, onConnect, onDisconnect });
  const fileFieldId = useId();
  // A saved PostgreSQL/MySQL address is reused when the field is left empty.
  const canDiscover = type === 'sqlite' ? Boolean(filePath.trim()) : Boolean(connectionString.trim()) || connected;

  return (
    <div ref={formRef} className={embedded ? 'connection-form connection-form--embedded' : 'connection-form'}>
      {!embedded && (
        <ConnectionGuide
          title="데이터베이스 연결"
          steps={[
            'SQLite 파일을 고르거나 PostgreSQL/MySQL 접속 주소를 입력합니다.',
            '테이블 목록을 불러와 읽어도 되는 테이블만 고릅니다. 고르지 않은 테이블은 읽지 않습니다.',
            '접속 주소는 이 컴퓨터의 보안 저장소에만 보관합니다.',
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
        <div className="field">
          <label htmlFor={fileFieldId}>SQLite 파일</label>
          <div className="field-row">
            <input id={fileFieldId} value={filePath} onChange={(event) => setFilePath(event.target.value)} placeholder={'C:\\data\\app.db'} />
            <button type="button" className="btn btn-secondary" onClick={() => void handlePickFile()} disabled={busy}>
              찾아보기
            </button>
          </div>
        </div>
      ) : (
        <label className="field">
          <span>접속 주소</span>
          <input
            value={connectionString}
            onChange={(event) => setConnectionString(event.target.value)}
            placeholder={
              connected
                ? '바꿀 때만 입력'
                : type === 'mysql'
                  ? 'mysql://user:pass@localhost:3306/db'
                  : 'postgresql://user:pass@localhost:5432/db'
            }
          />
        </label>
      )}

      {type !== 'sqlite' && (
        <label className="field">
          <span>읽을 영역(스키마) — 모르면 비워 두세요</span>
          <input
            value={allowedSchemas}
            onChange={(event) => setAllowedSchemas(event.target.value)}
            placeholder={type === 'mysql' ? 'ax_test' : 'public'}
          />
        </label>
      )}

      <RdbTablePicker
        selected={allowedTables}
        discovered={discovered}
        canDiscover={canDiscover}
        busy={busy}
        onChange={setAllowedTables}
        onDiscover={() => void discoverTables()}
      />

      <label className="field">
        <span>한 번에 읽는 최대 행 수</span>
        <input value={rowLimit} onChange={(event) => setRowLimit(event.target.value)} inputMode="numeric" />
      </label>

      <label className="field">
        <span>표시 이름 (선택)</span>
        <input value={label} onChange={(event) => setLabel(event.target.value)} />
      </label>

      <div className="connection-actions">
        <button type="button" className="btn btn-primary" onClick={() => void handleConnect()}
          disabled={busy || allowedTables.length === 0}
          title={allowedTables.length === 0 ? '읽어도 되는 테이블을 하나 이상 골라 주세요.' : undefined}>
          {connected ? '다시 연결' : '연결'}
        </button>
        {connected && (
          <button type="button" className="btn btn-secondary" onClick={() => void handleDisconnect()} disabled={busy}>
            연결 해제
          </button>
        )}
      </div>

      {message && <p className="form-message connection-form-message" role="status">{message}</p>}
      {warning && (
        <p className="form-message connection-form-message warning" role="alert">
          주의: {warning}
        </p>
      )}

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
