import { useEffect, useRef, useState } from 'react';
import type { AppState } from '../../../../../types/app-state';
import { connectionEntry } from '../../../../../ui/lib/connection-display';
import { confirmDisconnectConnector } from '../../../../../ui/lib/confirm-delete';
import { ipcErrorMessage } from '../../../../../ui/lib/ipc-error';
import { parseRowLimitInput, rdbConnectedItemsFor, rdbDatabaseTitle, rdbDatabasesFor, withObjectParticle } from './model';

export type RdbConnectionType = 'sqlite' | 'postgres' | 'mysql';

export interface RdbConnectionFormProps {
  state: AppState | null;
  embedded?: boolean;
  onPickSqliteFile: () => Promise<{ ok: boolean; canceled?: boolean; path?: string }>;
  onDiscoverTables: (payload: { databaseId?: string; type: 'mysql' | 'postgres' | 'sqlite'; filePath?: string; connectionString?: string }) => Promise<{ tables: string[]; truncated: boolean }>;
  onConnect: (payload: {
    /** The database being edited; absent when adding one. */
    databaseId?: string;
    type: RdbConnectionType;
    connectionString?: string;
    filePath?: string;
    allowedSchemas?: string[];
    allowedTables?: string[];
    rowLimit?: number;
    label?: string;
  }) => Promise<{ databaseId?: string; label?: string; warning?: string } | void>;
  /** Removes one database, or every one without an id. */
  onDisconnect: (databaseId?: string) => Promise<void>;
}

type RdbConnectionControllerProps = Pick<RdbConnectionFormProps, 'state' | 'onPickSqliteFile' | 'onDiscoverTables' | 'onConnect' | 'onDisconnect'>;

/** What the database showed when the person asked for its tables. */
export type DiscoveredTables =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; tables: string[]; truncated: boolean }
  | { status: 'failed'; message: string };

export function useRdbConnectionForm({
  state,
  onPickSqliteFile,
  onDiscoverTables,
  onConnect,
  onDisconnect,
}: RdbConnectionControllerProps) {
  const rdbEntry = connectionEntry(state, 'rdb');
  const databases = rdbDatabasesFor(state);
  const connected = Boolean(rdbEntry?.connected) && databases.length > 0;
  const formRef = useRef<HTMLDivElement>(null);
  /** The database being edited; undefined while adding one. */
  const [databaseId, setDatabaseId] = useState<string | undefined>(undefined);
  const [type, setType] = useState<RdbConnectionType>('sqlite');
  const [filePath, setFilePath] = useState('');
  const [connectionString, setConnectionString] = useState('');
  const [allowedSchemas, setAllowedSchemas] = useState('');
  const [allowedTables, setAllowedTables] = useState<string[]>([]);
  const [discovered, setDiscovered] = useState<DiscoveredTables>({ status: 'idle' });
  const [rowLimit, setRowLimit] = useState('1000');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  /** Non-blocking advice from the main process (e.g. a remote DB without TLS). */
  const [warning, setWarning] = useState('');
  // Only the latest request may show its tables: an older one finishing late (a slow database,
  // or the type or SQLite file changed meanwhile) must not replace the newer list.
  const tablesRequestRef = useRef(0);

  const loadFromConnection = (id: string, scroll = true) => {
    const database = databases.find((entry) => entry.id === id);
    if (!database?.dbType) return;
    setDatabaseId(database.id);
    setType(database.dbType);
    setLabel(database.label ?? '');
    setAllowedSchemas((database.allowedSchemas ?? []).join(', '));
    setAllowedTables([...(database.allowedTables ?? [])]);
    tablesRequestRef.current += 1;
    setDiscovered({ status: 'idle' });
    setRowLimit(database.rowLimit != null ? String(database.rowLimit) : '1000');
    if (database.dbType === 'sqlite') {
      setFilePath(database.target ?? '');
      setConnectionString('');
      void loadTables({ type: 'sqlite', filePath: database.target ?? '' });
    } else {
      setConnectionString('');
      setFilePath('');
    }
    setMessage('');
    setWarning('');
    if (scroll) formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const resetForm = () => {
    tablesRequestRef.current += 1;
    setDatabaseId(undefined);
    setType('sqlite');
    setFilePath('');
    setConnectionString('');
    setAllowedSchemas('');
    setAllowedTables([]);
    setDiscovered({ status: 'idle' });
    setRowLimit('1000');
    setLabel('');
  };

  // Opening the page of the one connected database shows it, ready to change. With several,
  // the person picks which one to change from the list.
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !connected) return;
    prefilled.current = true;
    if (databases.length === 1) loadFromConnection(databases[0]!.id, false);
  });

  const connectedItems = rdbConnectedItemsFor(databases);
  const editing = databaseId ? databases.find((entry) => entry.id === databaseId) : undefined;
  /** A blank address reuses the stored one only for the PostgreSQL/MySQL database being edited. */
  const storedAddressReusable = Boolean(editing && editing.dbType !== 'sqlite' && editing.dbType === type);
  /** Adding another database: its name is how Jev and the person tell them apart. */
  const addingAnother = !databaseId && databases.length > 0;

  const loadTables = async (target: Parameters<typeof onDiscoverTables>[0]) => {
    const request = ++tablesRequestRef.current;
    setDiscovered({ status: 'loading' });
    try {
      const { tables, truncated } = await onDiscoverTables(target);
      if (request === tablesRequestRef.current) setDiscovered({ status: 'loaded', tables, truncated });
    } catch (error) {
      if (request === tablesRequestRef.current) {
        setDiscovered({ status: 'failed', message: ipcErrorMessage(error, '테이블 목록을 불러오지 못했습니다.') });
      }
    }
  };

  const discoverTables = () => loadTables(type === 'sqlite'
    ? { type, filePath }
    : {
        type,
        connectionString: connectionString.trim() || undefined,
        databaseId: storedAddressReusable ? databaseId : undefined,
      });

  const changeType = (next: RdbConnectionType) => {
    tablesRequestRef.current += 1;
    setType(next);
    setDiscovered({ status: 'idle' });
  };

  // Editing the target makes a list still loading for the old one meaningless.
  const dropLoadingTables = () => {
    tablesRequestRef.current += 1;
    setDiscovered((current) => (current.status === 'loading' ? { status: 'idle' } : current));
  };
  const changeFilePath = (next: string) => {
    dropLoadingTables();
    setFilePath(next);
  };
  const changeConnectionString = (next: string) => {
    dropLoadingTables();
    setConnectionString(next);
  };

  const handlePickFile = async () => {
    try {
      const result = await onPickSqliteFile();
      if (result.ok && result.path) {
        setFilePath(result.path);
        void loadTables({ type: 'sqlite', filePath: result.path });
      }
    } catch (error) {
      setMessage(ipcErrorMessage(error, 'SQLite 파일을 선택하지 못했습니다.'));
    }
  };

  const handleConnect = async () => {
    setBusy(true);
    setMessage('');
    setWarning('');
    try {
      const result = await onConnect({
        databaseId,
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
        allowedTables,
        rowLimit: parseRowLimitInput(rowLimit),
        label: label.trim() || undefined,
      });
      const name = result?.label?.trim() || label.trim();
      setMessage(name
        ? `${withObjectParticle(name)} ${databaseId ? '수정했습니다.' : '연결했습니다.'}`
        : databaseId ? '데이터베이스 연결을 수정했습니다.' : '데이터베이스가 연결되었습니다.');
      if (result?.warning) setWarning(result.warning);
      resetForm();
    } catch (error) {
      setMessage(ipcErrorMessage(error, 'DB 연결에 실패했습니다.'));
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async (id?: string) => {
    const target = id ? databases.find((entry) => entry.id === id) : undefined;
    if (!await confirmDisconnectConnector(target ? rdbDatabaseTitle(target) : '데이터베이스')) return;
    setBusy(true);
    setMessage('');
    setWarning('');
    try {
      await onDisconnect(id);
      setMessage(target ? `${withObjectParticle(rdbDatabaseTitle(target))} 연결 해제했습니다.` : 'DB 연결이 해제되었습니다.');
      if (!id || id === databaseId) resetForm();
    } catch (error) {
      setMessage(ipcErrorMessage(error, '연결 해제에 실패했습니다.'));
    } finally {
      setBusy(false);
    }
  };

  return {
    formRef,
    connected,
    databaseId,
    storedAddressReusable,
    addingAnother,
    type,
    setType: changeType,
    filePath,
    setFilePath: changeFilePath,
    connectionString,
    setConnectionString: changeConnectionString,
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
    resetForm,
    handlePickFile,
    handleConnect,
    handleDisconnect,
  };
}
