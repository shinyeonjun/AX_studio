import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { DiscoveryInspectView } from '@ax-studio/core';
import type { RefreshDiscovery } from './result.js';

export interface UseDiscoveryActionsOptions {
  workspaceContextKeyRef: MutableRefObject<number>;
  operationEpochRef: MutableRefObject<number>;
  activeSessionRef: MutableRefObject<string | null>;
  setSessionId: Dispatch<SetStateAction<string | null>>;
  setSessionContextKey: Dispatch<SetStateAction<number | null>>;
  activeSessionId: string | null;
  activeView: DiscoveryInspectView | null;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  refresh: RefreshDiscovery;
  onPublished?: () => void | Promise<void>;
}

export type UseDiscoveryStartActionsOptions = Pick<
  UseDiscoveryActionsOptions,
  | 'workspaceContextKeyRef'
  | 'operationEpochRef'
  | 'activeSessionRef'
  | 'setSessionId'
  | 'setSessionContextKey'
  | 'setBusy'
  | 'setError'
  | 'refresh'
>;

export type UseDiscoverySessionActionsOptions = Pick<
  UseDiscoveryActionsOptions,
  | 'operationEpochRef'
  | 'activeSessionId'
  | 'activeView'
  | 'setBusy'
  | 'setError'
  | 'refresh'
  | 'onPublished'
>;
