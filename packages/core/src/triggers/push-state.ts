/** Lifecycle state emitted by a push transport such as Slack Socket Mode. */
export type PushTransportPhase =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export interface PushTransportState {
  phase: PushTransportPhase;
  error?: string;
}

export type PushTransportStateHandler = (state: PushTransportState) => void;
