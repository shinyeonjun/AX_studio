#!/usr/bin/env node
import { buildDesignToolContext } from '../../design-tools/context.js';
import { buildConnectorsFromStore } from '../../modules/registry.js';
import { CONNECTOR_CATALOG, CONNECTOR_IDS, isConnectorAlwaysOn } from '../../catalog/index.js';
import { createAxStudioCore } from '../../bootstrap.js';
import { AxCommandSchema } from './schema.js';

const USAGE = `AX command adapter

Usage:
  ax <command.name> [args-json]
  ax --json '<command-json>'
  echo '<command-json>' | ax --json

Examples:
  ax command.list
  ax workflow.list
  ax workflow.inspect '{"workflowId":"workflow-id"}'
`;

type CliEnvelope = {
  command: string;
  status: 'invalid' | 'error';
  issues: Array<{ code: string; message: string }>;
};

function connectedConnectorIds(store: { getConnections: () => Array<{ connector: string; connected: boolean }> }): string[] {
  const configured = store.getConnections().filter((entry) => entry.connected).map((entry) => entry.connector);
  const builtins = CONNECTOR_IDS.filter((id) => {
    const entry = CONNECTOR_CATALOG[id];
    return entry.runtimeAvailable && isConnectorAlwaysOn(id);
  });
  return [...new Set([...configured, ...builtins])];
}

function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { value += chunk; });
    process.stdin.on('end', () => resolve(value.trim()));
    process.stdin.on('error', reject);
  });
}

async function parseCommand(argv: string[]): Promise<unknown> {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(USAGE);
    return undefined;
  }

  if (args[0] === '--json') {
    const raw = args.slice(1).join(' ').trim() || await readStdin();
    if (!raw) throw new Error('AX command JSON이 필요합니다.');
    return JSON.parse(raw);
  }

  const name = args[0];
  const rawArgs = args.slice(1).join(' ').trim();
  const commandArgs = rawArgs ? JSON.parse(rawArgs) : {};
  if (!commandArgs || typeof commandArgs !== 'object' || Array.isArray(commandArgs)) {
    throw new Error('CLI 인자는 JSON 객체여야 합니다.');
  }
  return { name, args: commandArgs };
}

function errorEnvelope(command: string, status: CliEnvelope['status'], message: string): CliEnvelope {
  return {
    command,
    status,
    issues: [{ code: status === 'invalid' ? 'invalid_cli_input' : 'cli_host_error', message }],
  };
}

async function main(): Promise<void> {
  const raw = await parseCommand(process.argv);
  if (raw === undefined) return;

  const parsed = AxCommandSchema.safeParse(raw);
  if (!parsed.success) {
    process.stdout.write(`${JSON.stringify(errorEnvelope('command.list', 'invalid', parsed.error.message))}\n`);
    process.exitCode = 2;
    return;
  }

  const core = await createAxStudioCore({});
  try {
    const connections = core.store.getConnections();
    const connected = connectedConnectorIds(core.store);
    const designToolContext = buildDesignToolContext(connections, connected, {
      interactionMode: 'plain_chat',
      allowUntrustedData: true,
      connectors: buildConnectorsFromStore(core.store),
    });
    const result = await core.commandService.execute(parsed.data, { designToolContext });
    await core.runtime.waitForIdle();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === 'error' || result.status === 'invalid' || result.status === 'forbidden') {
      process.exitCode = 2;
    }
  } finally {
    core.db.close?.();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(`${JSON.stringify(errorEnvelope('host.init', 'error', message))}\n`);
  process.exitCode = 1;
});
