import { useRef, useState } from 'react';
import type { AppState } from '../../../../types/app-state';
import { connectionEntry, rdbTypeLabel } from '../../../../lib/connection-display';
import { confirmDisconnectConnector } from '../../../../lib/confirm-delete';

export type RdbConnectionType = 'sqlite' | 'postgres' | 'mysql';

export interface RdbConnectionFormProps {
  state: AppState | null;
  embedded?: boolean;
  onPickSqliteFile: () => Promise<{ ok: boolean; canceled?: boolean; path?: string }>;
  onConnect: (payload: {
    type: RdbConnectionType;
    connectionString?: string;
    filePath?: string;
    allowedSchemas?: string[];
    allowedTables?: string[];
    rowLimit?: number;
    label?: string;
  }) => Promise<void>;
  onDisconnect: () => Promise<void>;
}

type RdbConnectionControllerProps = Pick<RdbConnectionFormProps, 'state' | 'onPickSqliteFile' | 'onConnect' | 'onDisconnect'>;

export function useRdbConnectionForm({
  state,
  onPickSqliteFile,
  onConnect,
  onDisconnect,
}: RdbConnectionControllerProps) {
  const rdbEntry = connectionEntry(state, 'rdb');
  const connected = Boolean(rdbEntry?.connected);
  const formRef = useRef<HTMLDivElement>(null);
  const [type, setType] = useState<RdbConnectionType>('sqlite');
  const [filePath, setFilePath] = useState('');
  const [connectionString, setConnectionString] = useState('');
  const [allowedSchemas, setAllowedSchemas] = useState('');
  const [allowedTables, setAllowedTables] = useState('');
  const [rowLimit, setRowLimit] = useState('1000');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const loadFromConnection = () => {
    if (!rdbEntry?.connected || !rdbEntry.dbType) return;
    setType(rdbEntry.dbType);
    setLabel(rdbEntry.label ?? '');
    setAllowedSchemas((rdbEntry.allowedSchemas ?? []).join(', '));
    setAllowedTables((rdbEntry.allowedTables ?? []).join(', '));
    setRowLimit(rdbEntry.rowLimit != null ? String(rdbEntry.rowLimit) : '1000');
    if (rdbEntry.dbType === 'sqlite') {
      setFilePath(rdbEntry.target ?? '');
      setConnectionString('');
    } else {
      setConnectionString('');
      setFilePath('');
    }
    setMessage('');
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const connectedItems =
    connected && rdbEntry?.dbType
      ? [
          {
            id: 'rdb',
            title: rdbEntry.label?.trim() || rdbTypeLabel(rdbEntry.dbType),
            subtitle: rdbEntry.target,
            meta: [
              rdbTypeLabel(rdbEntry.dbType),
              rdbEntry.allowedTables?.length ? `테이블 ${rdbEntry.allowedTables.length}개` : undefined,
              rdbEntry.rowLimit != null ? `행 제한 ${rdbEntry.rowLimit}` : undefined,
            ]
              .filter(Boolean)
              .join(' · '),
          },
        ]
      : [];

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
        connectionString: type === 'postgres' || type === 'mysql' ? connectionString : undefined,
        allowedSchemas:
          type === 'sqlite'
            ? undefined
            : allowedSchemas
                .split(',')
                .map((entry) => entry.trim())
                .filter(Boolean),
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
    if (!confirmDisconnectConnector('데이터베이스')) return;
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

  return {
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
  };
}
