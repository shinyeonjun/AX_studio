import type { ConnectedResourcesSnapshot } from './connected-resources.js';
import type { InterviewDraft, WorkflowNode } from './workflow-schema.js';

const WATCH_FILE_PATTERNS =
  /새\s*(파일|pdf|문서|문서가)|올리(면|면)|생기(면|면)|추가되(면|면)|감시|들어오(면|면)|업로드|놓(으|)면|넣(으|)면/i;
const EXISTING_FILE_PATTERNS =
  /\d+\s*개\s*(있|있음|있는|있어)|하나\s*(있|있는|있어)|있는\s*(pdf|파일|문서)|현재\s*(폴더|있|pdf|파일)|기존\s*(pdf|파일|문서)|지금\s*(폴더|있)/i;

function isDocumentIngestNode(node: WorkflowNode): boolean {
  return (
    node.type === 'action' &&
    node.connector === 'document' &&
    (node.action === 'ingest' || node.action === 'document.ingest')
  );
}

function pathParamMissing(node: WorkflowNode): boolean {
  const path = node.params?.path;
  return typeof path !== 'string' || path.trim().length === 0;
}

function pathUsesTriggerPlaceholder(node: WorkflowNode): boolean {
  const path = node.params?.path;
  return typeof path === 'string' && path.includes('{{filePath}}');
}

function findSinglePdf(resources: ConnectedResourcesSnapshot): ListedFileRef | null {
  const pdfs: ListedFileRef[] = [];
  for (const folder of resources.localFolders) {
    for (const file of folder.files) {
      if (file.extension.toLowerCase() === '.pdf') {
        pdfs.push({ ...file, folderId: folder.id });
      }
    }
  }
  return pdfs.length === 1 ? pdfs[0]! : null;
}

interface ListedFileRef {
  filePath: string;
  fileName: string;
  extension: string;
  folderId: string;
}

function withIngestPath(node: WorkflowNode, path: string): WorkflowNode {
  return { ...node, params: { ...node.params, path } };
}

export function detectExistingFileIntent(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  if (WATCH_FILE_PATTERNS.test(normalized)) return false;
  return EXISTING_FILE_PATTERNS.test(normalized);
}

export function detectWatchNewFileIntent(text: string): boolean {
  return WATCH_FILE_PATTERNS.test(text.trim());
}

function intentText(draft: InterviewDraft, userInstruction?: string): string {
  return [userInstruction, draft.goal, draft.assumptions.join('\n')].filter(Boolean).join('\n');
}

/** Whether ingest should store a concrete path at design time (not {{filePath}}). */
export function shouldBakeConcreteIngestPath(
  draft: InterviewDraft,
  resources: ConnectedResourcesSnapshot | undefined,
  userInstruction?: string,
): boolean {
  const singlePdf = resources ? findSinglePdf(resources) : null;
  if (!singlePdf) return false;

  const text = intentText(draft, userInstruction);
  if (draft.triggerType === 'manual' || draft.triggerType === 'once') return true;
  if (draft.triggerType === 'local_folder.new_file') {
    if (detectWatchNewFileIntent(text) && !detectExistingFileIntent(text)) return false;
    if (detectExistingFileIntent(text)) return true;
    return false;
  }
  return detectExistingFileIntent(text);
}

/** Fill obvious gaps using connected folder listings (no LLM round-trip). */
export function resolveInterviewDraftDefaults(
  draft: InterviewDraft,
  resources: ConnectedResourcesSnapshot | undefined,
  options?: { userInstruction?: string },
): InterviewDraft {
  if (!resources?.localFolders.length) return draft;

  let next = draft;
  const singleFolder = resources.localFolders.length === 1 ? resources.localFolders[0]! : null;
  const singlePdf = findSinglePdf(resources);
  const bakeConcretePath = shouldBakeConcreteIngestPath(next, resources, options?.userInstruction);

  if (
    next.triggerType === 'local_folder.new_file' &&
    !next.localFolderId?.trim() &&
    singleFolder
  ) {
    next = { ...next, localFolderId: singleFolder.id };
  }

  if (bakeConcretePath && next.triggerType === 'local_folder.new_file') {
    next = { ...next, triggerType: 'manual' };
  }

  const nodes = next.nodes.map((node) => {
    if (!isDocumentIngestNode(node)) return node;

    if (bakeConcretePath && singlePdf && (pathParamMissing(node) || pathUsesTriggerPlaceholder(node))) {
      return withIngestPath(node, singlePdf.filePath);
    }

    if (!pathParamMissing(node)) return node;

    if (next.triggerType === 'local_folder.new_file') {
      return withIngestPath(node, '{{filePath}}');
    }

    if (singlePdf) {
      return withIngestPath(node, singlePdf.filePath);
    }

    return node;
  });

  if (nodes !== next.nodes) {
    next = { ...next, nodes };
  }

  return next;
}
