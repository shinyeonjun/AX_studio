import { z } from 'zod';

export const CapabilityRiskSchema = z.enum(['read', 'write', 'trigger']);

export const ConnectorCapabilitySchema = z.object({
  id: z.string(),
  connector: z.string(),
  kind: z.enum(['read', 'write', 'trigger']),
  description: z.string(),
  sideEffect: z.enum(['NONE', 'REVERSIBLE', 'EXTERNAL', 'EXTERNAL_HIGH']).optional(),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
});

export type ConnectorCapability = z.infer<typeof ConnectorCapabilitySchema>;

export const CAPABILITY_CATALOG: ConnectorCapability[] = [
  { id: 'gmail.messages.read', connector: 'gmail', kind: 'read', description: 'Read email messages', sideEffect: 'NONE' },
  { id: 'gmail.messages.search', connector: 'gmail', kind: 'read', description: 'Search emails', sideEffect: 'NONE' },
  { id: 'gmail.draft.create', connector: 'gmail', kind: 'write', description: 'Create draft', sideEffect: 'REVERSIBLE' },
  { id: 'gmail.message.send', connector: 'gmail', kind: 'write', description: 'Send email', sideEffect: 'EXTERNAL_HIGH' },
  { id: 'gmail.new_message', connector: 'gmail', kind: 'trigger', description: 'New email trigger' },
  { id: 'slack.message.send', connector: 'slack', kind: 'write', description: 'Send Slack message', sideEffect: 'EXTERNAL' },
  { id: 'rdb.schema.describe', connector: 'rdb', kind: 'read', description: 'Describe DB schema', sideEffect: 'NONE' },
  { id: 'rdb.query.read', connector: 'rdb', kind: 'read', description: 'Read-only SQL query', sideEffect: 'NONE' },
  { id: 'local_sheet.read', connector: 'local_sheet', kind: 'read', description: 'Read CSV/xlsx', sideEffect: 'NONE' },
  { id: 'report.html.render', connector: 'report', kind: 'write', description: 'Render HTML report', sideEffect: 'REVERSIBLE' },
  { id: 'report.docx.fill', connector: 'report', kind: 'write', description: 'Fill DOCX template', sideEffect: 'REVERSIBLE' },
  { id: 'report.pdf.generate', connector: 'report', kind: 'write', description: 'Generate PDF', sideEffect: 'REVERSIBLE' },
];

export function getCapability(id: string): ConnectorCapability | undefined {
  return CAPABILITY_CATALOG.find((c) => c.id === id);
}

export function getCapabilitiesForConnector(connector: string): ConnectorCapability[] {
  return CAPABILITY_CATALOG.filter((c) => c.connector === connector);
}

export interface ConnectorConnection {
  connector: string;
  connected: boolean;
  config?: Record<string, unknown>;
}

export function checkRequiredConnections(
  requiredCapabilityIds: string[],
  connections: ConnectorConnection[],
): { missing: string[] } {
  const connectedConnectors = new Set(
    connections.filter((c) => c.connected).map((c) => c.connector),
  );
  const missing: string[] = [];
  for (const capId of requiredCapabilityIds) {
    const cap = getCapability(capId);
    if (!cap) continue;
    if (!connectedConnectors.has(cap.connector)) {
      if (!missing.includes(cap.connector)) {
        missing.push(cap.connector);
      }
    }
  }
  return { missing };
}
