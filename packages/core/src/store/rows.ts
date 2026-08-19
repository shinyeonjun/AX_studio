export interface WorkflowRow {
  id: string;
  name: string;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface WorkflowVersionRow {
  id: string;
  workflow_id: string;
  version: number;
  ir_json: string;
  created_at: string;
}

export interface ExecutionRow {
  id: string;
  workflow_id: string | null;
  workflow_version: number | null;
  ephemeral: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  error_code: string | null;
  log_json: string;
  ir_json: string | null;
  trigger_type: string | null;
}

export interface ApprovalRow {
  id: string;
  execution_id: string;
  action_ids_json: string;
  reason: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  payload_json: string | null;
}

export interface SettingRow {
  key: string;
  value_json: string;
}

export interface ConnectionRow {
  connector: string;
  connected: number;
  config_json: string | null;
}
