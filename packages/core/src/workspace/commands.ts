export type WorkspaceExecutionMode = 'once' | 'workflow';

export type WorkspaceCommand =
  | { mode: 'chat'; text: string }
  | { mode: 'once'; instruction: string }
  | { mode: 'workflow'; instruction: string };

const ONCE_RE = /^\/once(?:\s+([\s\S]*))?$/i;
const WORKFLOW_RE = /^\/workflow(?:\s+([\s\S]*))?$/i;

/** Parse user input into default chat, /once, or /workflow. */
export function parseWorkspaceCommand(raw: string): WorkspaceCommand {
  const text = raw.trim();
  const once = text.match(ONCE_RE);
  if (once) return { mode: 'once', instruction: (once[1] ?? '').trim() };
  const workflow = text.match(WORKFLOW_RE);
  if (workflow) return { mode: 'workflow', instruction: (workflow[1] ?? '').trim() };
  return { mode: 'chat', text };
}
