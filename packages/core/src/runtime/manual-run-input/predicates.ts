import type { Step, WorkflowIR } from '../../workflow/schema.js';

export function workflowHasDocumentIngest(ir: WorkflowIR): boolean {
  return (
    ir.steps?.some(
      (step) => step.type === 'action' && step.connector === 'document' && step.action === 'ingest',
    ) ?? false
  );
}

export function workflowNeedsFilePath(ir: WorkflowIR): boolean {
  return (
    ir.steps?.some(
      (step) =>
        step.type === 'action' &&
        step.connector === 'document' &&
        step.action === 'ingest' &&
        typeof step.params?.path === 'string' &&
        step.params.path.includes('filePath'),
    ) ?? false
  );
}

export function workflowNeedsGmailMessageId(ir: WorkflowIR): boolean {
  if (ir.trigger?.type !== 'gmail.new_message') return false;
  return (
    ir.steps?.some(
      (step) =>
        step.type === 'action' &&
        step.connector === 'gmail' &&
        (step.action === 'messages.read' || step.action === 'message.read'),
    ) ?? false
  );
}

export function inferExtensions(ir: WorkflowIR): string[] | undefined {
  if (ir.trigger?.type === 'local_folder.new_file') {
    return ir.trigger.extensions;
  }
  return ['.pdf'];
}

export function firstActionStep(ir: WorkflowIR): Extract<Step, { type: 'action' }> | undefined {
  return ir.steps?.find((step): step is Extract<Step, { type: 'action' }> => step.type === 'action');
}
