import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', '.git', 'agent-transcripts']);
const SKIP_FILE = /SKILL\.md$|skill-load\.ts$|embed-skills\.mjs$/;

const REPLACEMENTS = [
  ['bootstrapInterviewFromWorkflow', 'bootstrapInterviewFromWorkflow'],
  ['bootstrap-from-workflow', 'bootstrap-from-workflow'],
  ['renderWorkflowDocument', 'renderWorkflowDocument'],
  ['workflow-document', 'workflow-document'],
  ['workflowDocument', 'workflowDocument'],
  ['validateWorkflowIR', 'validateWorkflowIR'],
  ['parseWorkflowIR', 'parseWorkflowIR'],
  ['csMailWorkflowFixture', 'csMailWorkflowFixture'],
  ['stockReportWorkflowFixture', 'stockReportWorkflowFixture'],
  ['proposeWorkflowRevision', 'proposeWorkflowRevision'],
  ['WorkflowRevisionSchema', 'WorkflowRevisionSchema'],
  ['summarizeWorkflow', 'summarizeWorkflow'],
  ['executeWorkflow', 'executeWorkflow'],
  ['WorkflowIRSchema', 'WorkflowIRSchema'],
  ['WorkflowRuntime', 'WorkflowRuntime'],
  ['WorkSummary', 'WorkSummary'],
  ['WorkflowStore', 'WorkflowStore'],
  ['WorkflowIR', 'WorkflowIR'],
  ['workflowActive', 'workflowActive'],
  ['workflow-repository', 'workflow-repository'],
  ['workflow-store', 'workflow-store'],
  ['workflow_versions', 'workflow_versions'],
  ['workflow_version', 'workflow_version'],
  ['workflow_id', 'workflow_id'],
  ['listWorkflows', 'listWorkflows'],
  ['saveWorkflow', 'saveWorkflow'],
  ['getWorkflow', 'getWorkflow'],
  ['deleteWorkflow', 'deleteWorkflow'],
  ['setWorkflowActive', 'setWorkflowActive'],
  ['runWorkflow', 'runWorkflow'],
  ['loadWorkChat', 'loadWorkChat'],
  ['openWorkChat', 'openWorkChat'],
  ['onRunWorkflow', 'onRunWorkflow'],
  ['onToggleWork', 'onToggleWork'],
  ['onDeleteWork', 'onDeleteWork'],
  ['onOpenWork', 'onOpenWork'],
  ['work-display', 'work-display'],
  ['workflowId', 'workflowId'],
  ["from '../workflow/", "from '../workflow/"],
  ["from '../../workflow/", "from '../../workflow/"],
  ["from './workflow/", "from './workflow/"],
  ["'../workflow/", "'../workflow/"],
  ["'../../workflow/", "'../../workflow/"],
  ["'./workflow/", "'./workflow/"],
  ['workflow/approval', 'workflow/approval'],
  ['workflow/schema', 'workflow/schema'],
  ['workflow/fixtures', 'workflow/fixtures'],
  ['shouldRunWorkflowAfterSave', 'shouldRunWorkflowAfterSave'],
  ['isEventTriggerType', 'isEventTriggerType'],
  ['getChatSessionByWorkflowId', 'getChatSessionByWorkflowId'],
  ['linkChatSessionToWorkflow', 'linkChatSessionToWorkflow'],
  ['FROM workflows', 'FROM workflows'],
  ['INTO workflows', 'INTO workflows'],
  ['TABLE workflows', 'TABLE workflows'],
  ['workflows w', 'workflows w'],
  ['workflows WHERE', 'workflows WHERE'],
  ['CREATE TABLE IF NOT EXISTS workflows', 'CREATE TABLE IF NOT EXISTS workflows'],
  ['state.works', 'state.works'],
  ['works:', 'works:'],
  ['works.', 'works.'],
  ['works,', 'works,'],
  ['works)', 'works)'],
  ['works ', 'works '],
  ['skills\n', 'works\n'],
  ['works.length', 'works.length'],
  ['works.map', 'works.map'],
  ['(works', '(works'],
  [' works', ' works'],
];

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const rel = relative(ROOT, path);
    if (SKIP_DIRS.has(name) || rel.includes('agent\\skills') || rel.includes('agent/skills')) continue;
    const st = statSync(path);
    if (st.isDirectory()) walk(path, files);
    else if (/\.(ts|tsx|md|json|mjs)$/.test(name) && !SKIP_FILE.test(name)) files.push(path);
  }
  return files;
}

let changed = 0;
for (const file of walk(ROOT)) {
  let text = readFileSync(file, 'utf8');
  let next = text;
  for (const [from, to] of REPLACEMENTS) {
    next = next.split(from).join(to);
  }
  if (next !== text) {
    writeFileSync(file, next, 'utf8');
    changed += 1;
    console.log(relative(ROOT, file));
  }
}
console.log(`Updated ${changed} files`);
