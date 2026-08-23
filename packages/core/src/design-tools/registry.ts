import { capabilitiesDescribe } from './tools/capabilities-describe.js';
import { capabilitiesInvoke } from './tools/capabilities-invoke.js';
import { capabilitiesList } from './tools/capabilities-list.js';
import { connectionsList } from './tools/connections-list.js';
import { sourcesFilesList } from './tools/sources-files-list.js';
import { sourcesFileRead } from './tools/sources-file-read.js';
import { sourcesSearch } from './tools/sources-search.js';
import { sourcesList } from './tools/sources-list.js';
import { formatDesignToolsList } from './tools/tools-list.js';
import type { DesignToolHandler, DesignToolId } from './types.js';

export interface DesignToolDefinition {
  id: DesignToolId;
  description: string;
  args: string;
  handler: DesignToolHandler;
}

export const DESIGN_TOOL_REGISTRY: DesignToolDefinition[] = [
  {
    id: 'tools.list',
    description: 'design-tools 조회 도구 목록 (id, 설명, args)',
    args: '(none)',
    handler: () => formatDesignToolsList(DESIGN_TOOL_REGISTRY),
  },
  {
    id: 'connections.list',
    description: '설정에 연결된 서비스·내장 도구 목록',
    args: '(none)',
    handler: connectionsList,
  },
  {
    id: 'sources.list',
    description: '연결된 Gmail / Slack / 로컬 폴더 소스 목록',
    args: '{ connector?: "gmail" | "slack" | "local_folder" }',
    handler: sourcesList,
  },
  {
    id: 'sources.files.list',
    description: '연결 로컬 폴더의 파일 목록 (설계용 read-only)',
    args: '{ folderId: string, extensions?: string[] | ".pdf,.docx" }',
    handler: sourcesFilesList,
  },
  {
    id: 'sources.file.read',
    description: '연결 로컬 폴더 안 PDF 본문 일부 읽기 (read-only, 길이 제한)',
    args: '{ folderId: string, path: string, maxChars?: number }',
    handler: sourcesFileRead,
  },
  {
    id: 'sources.search',
    description: '로컬 폴더 텍스트 인덱스 검색 (인덱스 꺼짐 시 sources.files.list로 후퇴)',
    args: '{ query: string, folderId?: string, limit?: number }',
    handler: sourcesSearch,
  },
  {
    id: 'capabilities.list',
    description: '현재 연결 기준으로 워크플로우에 쓸 수 있는 capability 목록',
    args: '{ connector?: string, kind?: "read" | "write" | "trigger" }',
    handler: capabilitiesList,
  },
  {
    id: 'capabilities.describe',
    description: 'capability id의 param·sideEffect 상세',
    args: '{ id: string }',
    handler: capabilitiesDescribe,
  },
  {
    id: 'capabilities.invoke',
    description: '읽기 전용 capability 실행 (Slack 검색/읽기 등). citations 포함',
    args: '{ id: string, params?: Record<string, unknown> }',
    handler: capabilitiesInvoke,
  },
];

const handlers = new Map<DesignToolId, DesignToolDefinition>(
  DESIGN_TOOL_REGISTRY.map((entry) => [entry.id, entry]),
);

export function getDesignTool(id: DesignToolId): DesignToolDefinition | undefined {
  return handlers.get(id);
}

export function listDesignTools(): DesignToolDefinition[] {
  return [...DESIGN_TOOL_REGISTRY];
}
