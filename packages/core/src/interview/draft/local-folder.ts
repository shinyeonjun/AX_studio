import { normalize } from 'node:path';
import type { ChatMessage } from '../../agent/model/chat.js';
import type { WorkScope } from '../session/work-scope.js';
import type { InterviewDraft, WorkflowNode } from './schema.js';
import type { ConnectedResourcesSnapshot, ListedFileRef } from '../resources/connected-resources.js';
import { fileRefFromLocalScan } from '../../contracts/artifacts/file-ref.js';
import {
  getNodeParams,
  normalizeDraftActions,
  replaceActionParams,
  resolveNodeConnectorAction,
} from './actions.js';

function listPdfs(resources: ConnectedResourcesSnapshot): ListedFileRef[] {
  const pdfs: ListedFileRef[] = [];
  for (const folder of resources.localFolders) {
    for (const file of folder.files) {
      if (file.extension.toLowerCase() === '.pdf') {
        pdfs.push({ ...file, folderId: folder.id });
      }
    }
  }
  return pdfs;
}

function fileRefFromListedFile(file: ListedFileRef) {
  return fileRefFromLocalScan({
    folderId: file.folderId,
    filePath: file.filePath,
    fileName: file.fileName,
    extension: file.extension,
  });
}

function normalizedPath(path: string): string {
  return normalize(path).toLowerCase();
}

function isDocumentIngestNode(draft: InterviewDraft, node: WorkflowNode): boolean {
  const resolved = resolveNodeConnectorAction(draft, node);
  return resolved?.connector === 'document' && resolved.action === 'ingest';
}

function selectedPdfForNode(
  draft: InterviewDraft,
  node: WorkflowNode,
  resources: ConnectedResourcesSnapshot,
): ListedFileRef | null {
  const pdfs = listPdfs(resources);
  const params = getNodeParams(draft, node);
  const requestedPath = typeof params.path === 'string' ? params.path.trim() : '';
  if (requestedPath) {
    const exact = pdfs.find((file) => normalizedPath(file.filePath) === normalizedPath(requestedPath));
    if (exact) return exact;
  }
  return pdfs.length === 1 ? pdfs[0]! : null;
}

function stripIngestPlaceholderPath(draft: InterviewDraft, node: WorkflowNode): InterviewDraft {
  if (!isDocumentIngestNode(draft, node)) return draft;
  const params = { ...getNodeParams(draft, node) };
  delete params.path;
  delete params.file;
  return replaceActionParams(draft, node, params);
}

function resolveManualIngestFile(
  draft: InterviewDraft,
  node: WorkflowNode,
  resources: ConnectedResourcesSnapshot,
): InterviewDraft {
  if (!isDocumentIngestNode(draft, node)) return draft;
  const selected = selectedPdfForNode(draft, node, resources);
  if (!selected) return draft;

  const params = { ...getNodeParams(stripIngestPlaceholderPath(draft, node), node) };
  delete params.path;
  params.file = fileRefFromListedFile(selected);
  return replaceActionParams(draft, node, params);
}

export function normalizeLocalFolderDraft(
  draft: InterviewDraft,
  resources?: ConnectedResourcesSnapshot,
): InterviewDraft {
  let next = normalizeDraftActions(draft);
  if (!resources?.localFolders.length) return next;

  const soleFolder = resources.localFolders.length === 1 ? resources.localFolders[0] : undefined;
  const pdfs = listPdfs(resources);

  if (next.triggerType === 'local_folder.new_file') {
    const requestedFolder = next.localFolderId?.trim()
      ? resources.localFolders.find((folder) => folder.id === next.localFolderId?.trim())
      : undefined;
    const selectedFolder = requestedFolder
      ? requestedFolder.accessible !== false
        ? requestedFolder
        : undefined
      : soleFolder?.accessible !== false
        ? soleFolder
        : undefined;
    if (requestedFolder?.accessible === false) {
      next.localFolderId = undefined;
      next.localFolderPath = undefined;
    }
    if (!next.localFolderId?.trim() && selectedFolder) {
      next.localFolderId = selectedFolder.id;
    }
    if (!next.localFolderPath?.trim() && selectedFolder) {
      next.localFolderPath = selectedFolder.path;
    }
    if (!next.localFolderExtensions?.trim() && (/\bpdf\b/i.test(next.goal) || pdfs.length > 0)) {
      next.localFolderExtensions = '.pdf';
    }
    for (const node of next.nodes) {
      next = stripIngestPlaceholderPath(next, node);
    }
  }

  if (next.triggerType === 'manual') {
    for (const node of next.nodes) {
      next = resolveManualIngestFile(next, node, resources);
    }
  }

  return next;
}

export function buildInterviewSessionHints(
  messages: ChatMessage[],
  instruction: string,
  workScope: WorkScope,
): string {
  const corpus = [instruction, ...messages.map((message) => message.content)].join('\n');
  const lastUser = [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
  const mentionsLocalFolder = /연결된\s*폴더|폴더(?:의|에|에서).*pdf|pdf.*폴더|새\s*파일/i.test(corpus);
  const lines: string[] = [];

  if (/이미\s*(있|들어|넣)|있어요|있거든|있잖|추가\s*해\s*놓|넣어\s*놓|들어\s*있/.test(lastUser)) {
    lines.push('- 사용자: 연결 폴더에 파일이 이미 있다고 했습니다. "파일을 추가/업로드하세요"라고 요청하지 마세요.');
    if (workScope === 'once') {
      lines.push('- 기존 파일을 한 번 처리하려면 plan에서 triggerType=manual과 connected_resources의 검증된 FileRef를 사용하세요.');
    } else {
      lines.push('- 다회성 업무에서는 기존 파일을 baseline으로 보고, 이후 새 파일을 감시하는 시작 조건을 사용자 의도에 맞게 설계하세요.');
    }
  }

  if (workScope === 'recurring' && mentionsLocalFolder) {
    lines.push('- 연결 폴더의 새 파일 업무라면 triggerType=local_folder.new_file을 사용하고, 시작 시 기존 파일을 baseline으로 처리하지 마세요.');
  }

  return lines.length > 0 ? lines.join('\n') : '(없음)';
}
