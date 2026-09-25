#!/usr/bin/env node
import { app, safeStorage } from 'electron';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDesignToolContext,
  buildJevReadOperationIndex,
  createAxStudioCore,
  JevDecisionEngine,
  runAxCommandChat,
  enableAppFileLog,
} from '@ax-studio/core';
import { GmailConnector } from '@ax-studio/core';
import { SlackConnector } from '@ax-studio/core';
import { emailAddresses, isAllowedTestChannel, isAllowedTestRecipients } from './live-send-policy.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const dataRoot = process.env.AX_DATA_ROOT?.trim()
  || join(process.env.TEMP ?? '', 'AXStudio-AX_Studio_jev');
const scenarioPath = process.env.AX_LIVE_CHAT_SCENARIO?.trim()
  || join(repoRoot, 'test/product-qa/scenarios/live-connector-batch.json');

function safeCredentialName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function decryptFile(path) {
  if (!existsSync(path)) return null;
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS 자격 증명 암호화를 사용할 수 없습니다.');
  }
  return safeStorage.decryptString(readFileSync(path));
}

function decryptSecret(name) {
  return decryptFile(join(dataRoot, 'credentials', `secret-${safeCredentialName(name)}.cred`));
}

function parseEnvFile() {
  const path = join(repoRoot, '.env');
  if (!existsSync(path)) return {};
  const values = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line);
    if (!match) continue;
    values[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/u, '$2');
  }
  return values;
}

function readJsonCredential(path) {
  const value = decryptFile(path);
  return value ? JSON.parse(value) : null;
}

async function hydrateConnectors(core) {
  const connections = core.store.getConnections();
  const slack = connections.find((entry) => entry.connector === 'slack');
  if (slack?.connected) {
    const secret = decryptSecret('slack.tokens');
    const parsed = secret ? JSON.parse(secret) : null;
    if (!parsed?.token) throw new Error('Slack 토큰을 읽지 못했습니다.');
    core.runtime.setConnector('slack', new SlackConnector(parsed.token));
  }

  const gmail = connections.find((entry) => entry.connector === 'gmail');
  const config = gmail?.config;
  const ref = config && typeof config === 'object' && !Array.isArray(config)
    ? config.credentialRef
    : undefined;
  if (gmail?.connected && ref && typeof ref === 'object' && typeof ref.connectionId === 'string') {
    const credential = readJsonCredential(join(
      dataRoot,
      'credentials',
      `gmail-${ref.connectionId}.cred`,
    ));
    const env = parseEnvFile();
    if (!credential?.refreshToken || !env.GOOGLE_OAUTH_CLIENT_ID) {
      throw new Error('Gmail OAuth 자격 증명을 읽지 못했습니다.');
    }
    core.runtime.setConnector('gmail', new GmailConnector({
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refreshToken: credential.refreshToken,
      accessToken: credential.accessToken,
      expiryDate: credential.expiryDate,
      email: typeof config.account === 'string' ? config.account : undefined,
    }));
  }
}

function instrumentConnector(core, connectorId, calls) {
  const connector = core.runtime.connectors[connectorId];
  if (!connector) return;
  const execute = connector.execute.bind(connector);
  core.runtime.setConnector(connectorId, {
    name: connector.name,
    async execute(action, params, context) {
      const startedAt = Date.now();
      const result = await execute(action, params, context);
      calls.push({
        connector: connectorId,
        action,
        durationMs: Date.now() - startedAt,
        ok: result.ok,
        ...(result.ok ? {} : { errorCode: result.errorCode, error: result.error }),
      });
      return result;
    },
  });
}

function instrumentCommandService(core, calls) {
  const execute = core.commandService.execute.bind(core.commandService);
  core.commandService.execute = async (command, context) => {
    const startedAt = Date.now();
    try {
      const result = await execute(command, context);
      calls.push({ name: command.name, status: result.status, durationMs: Date.now() - startedAt });
      return result;
    } catch (error) {
      calls.push({
        name: command.name,
        status: 'threw',
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
}

function instrumentAgentHarness(core, calls) {
  const run = core.agentHarness.run.bind(core.agentHarness);
  const runText = core.agentHarness.runText.bind(core.agentHarness);
  const record = (kind, request, promise) => {
    const startedAt = Date.now();
    const entry = { kind, phase: request.logContext };
    calls.push(entry);
    return promise.then(
      (result) => {
        entry.durationMs = result.durationMs ?? Date.now() - startedAt;
        entry.ok = true;
        return result;
      },
      (error) => {
        entry.durationMs = Date.now() - startedAt;
        entry.ok = false;
        throw error;
      },
    );
  };
  core.agentHarness.run = (request) => record('structured', request, run(request));
  core.agentHarness.runText = (request) => record('text', request, runText(request));
}

function countedDecisionEngine(decisionEngine, calls) {
  if (!decisionEngine) return undefined;
  const evaluate = decisionEngine.evaluate.bind(decisionEngine);
  return {
    async evaluate(request) {
      const startedAt = Date.now();
      try {
        const result = await evaluate(request);
        calls.push({
          durationMs: Date.now() - startedAt,
          questionIds: Object.keys(request.questions),
          ok: true,
        });
        return result;
      } catch (error) {
        calls.push({
          durationMs: Date.now() - startedAt,
          questionIds: Object.keys(request.questions),
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  };
}

const DEFAULT_TEST_EMAIL = {
  to: emailAddresses(process.env.AX_LIVE_TEST_EMAILS ?? ''),
  subject: 'AX Studio 실사용 전송 테스트',
  body: 'AX Studio 연결 및 실제 Gmail 전송 테스트 메일입니다. 별도 회신은 필요하지 않습니다.',
};

const TEST_SLACK_CHANNEL_IDS = new Set(
  (process.env.AX_LIVE_TEST_SLACK_CHANNEL_IDS ?? '').split(/[\s,]+/u).filter(Boolean),
);

function interpolateTestEmailRecipients(value, recipients) {
  if (typeof value === 'string') return value.replaceAll('{{TEST_EMAIL_TO}}', recipients);
  if (Array.isArray(value)) return value.map((entry) => interpolateTestEmailRecipients(entry, recipients));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      interpolateTestEmailRecipients(entry, recipients),
    ]));
  }
  return value;
}

function explicitExternalApproval(userMessage) {
  if (/초안만|전송하지\s*마|발송하지\s*마|저장하지\s*마|활성화하지\s*마|실행하지\s*마/iu.test(userMessage)) {
    return false;
  }
  return /보내|전송|발송|승인|실행해/iu.test(userMessage);
}

function approvalActions(core, approval) {
  const execution = core.store.getExecution(approval.executionId);
  if (!execution?.irJson) return { execution, actions: [], error: 'execution_snapshot_missing' };
  try {
    const snapshot = JSON.parse(execution.irJson);
    const actionIds = new Set(approval.actionIds);
    const actions = Array.isArray(snapshot.steps)
      ? snapshot.steps.filter((step) => step?.type === 'action' && actionIds.has(step.id))
      : [];
    return { execution, actions };
  } catch (error) {
    return {
      execution,
      actions: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function isAllowedTestAction(actions, scenario) {
  const testEmail = scenario.testEmail ?? DEFAULT_TEST_EMAIL;
  const allowedEmails = new Set(testEmail.to.map((value) => value.toLowerCase()));
  if (actions.length === 0) return { ok: false, reason: 'no_approved_actions' };

  for (const step of actions) {
    if (step.connector === 'slack' && step.action === 'message.send') {
      if (!isAllowedTestChannel(step.params?.channel, TEST_SLACK_CHANNEL_IDS)) {
        return { ok: false, reason: 'slack_channel_not_allowlisted' };
      }
      continue;
    }
    if (step.connector === 'gmail' && step.action === 'message.send') {
      if (!isAllowedTestRecipients(step.params?.to, allowedEmails)) {
        return { ok: false, reason: 'gmail_recipient_not_allowlisted' };
      }
      if (step.params?.subject !== testEmail.subject) return { ok: false, reason: 'gmail_subject_mismatch' };
      if (typeof step.params?.body !== 'string' || !step.params.body.includes(testEmail.body)) {
        return { ok: false, reason: 'gmail_body_mismatch' };
      }
      continue;
    }
    return { ok: false, reason: 'action_not_allowlisted' };
  }
  return { ok: true };
}

async function settleApprovals(core, scenario, beforeApprovalIds, userMessage) {
  const events = [];
  const seen = new Set(beforeApprovalIds);
  const mayApprove = process.env.AX_ALLOW_LIVE_EXTERNAL_SEND === '1'
    && Boolean(scenario.autoApproveExternal)
    && explicitExternalApproval(userMessage);

  // The one-shot queue is asynchronous; wait before inspecting approvals so the
  // measurement includes the actual Runtime gate, not only enqueue latency.
  await core.runtime.waitForIdle();
  for (let round = 0; round < 8; round += 1) {
    const pending = core.store.getPendingApprovals().filter((approval) => !seen.has(approval.id));
    if (pending.length === 0) break;
    for (const approval of pending) {
      seen.add(approval.id);
      const { execution, actions, error } = approvalActions(core, approval);
      const decision = error
        ? { ok: false, reason: error }
        : isAllowedTestAction(actions, scenario);
      const event = {
        approvalId: approval.id,
        executionId: approval.executionId,
        actionIds: approval.actionIds,
        actions: actions.map((step) => ({ connector: step.connector, action: step.action })),
        autoApprovalRequested: mayApprove,
        allowlisted: decision.ok,
        ...(decision.ok ? {} : { reason: decision.reason }),
      };
      if (!mayApprove || !decision.ok) {
        events.push({ ...event, status: 'left_pending' });
        continue;
      }
      const result = await core.runtime.continueAfterApproval(approval.id);
      events.push({ ...event, status: result.status, errorCode: result.errorCode });
      await core.runtime.waitForIdle();
    }
  }
  return { events, pendingApprovalCount: core.store.getPendingApprovals().length };
}

async function runDirectOutboundChecks(
  core,
  scenario,
  workspaceSessionId,
  calls,
  commandCalls,
  approvalEvents,
) {
  const checks = Array.isArray(scenario.directOutboundChecks) ? scenario.directOutboundChecks : [];
  const results = [];
  for (const check of checks) {
    const beforeCalls = calls.length;
    const beforeCommands = commandCalls.length;
    const beforeApprovals = new Set(core.store.getPendingApprovals().map((approval) => approval.id));
    const commandResult = await core.commandService.execute({
      name: 'execution.enqueue_once',
      args: check.args,
    }, {
      executionContext: { origin: 'agent' },
      userMessage: check.approvalMessage,
      workspaceSessionId,
    });
    await core.runtime.waitForIdle();
    const approvals = await settleApprovals(core, scenario, beforeApprovals, check.approvalMessage);
    approvalEvents.push(...approvals.events);
    const result = {
      id: check.id,
      commandResult,
      commandCalls: commandCalls.slice(beforeCommands),
      connectorCalls: calls.slice(beforeCalls),
      approvals: approvals.events,
      pendingApprovalCount: approvals.pendingApprovalCount,
    };
    results.push(result);
    console.log(JSON.stringify({ directOutbound: result }));
  }
  return results;
}

async function main() {
  app.setPath('userData', join(dataRoot, 'electron'));
  await app.whenReady();
  enableAppFileLog();

  const scenario = interpolateTestEmailRecipients(
    JSON.parse(readFileSync(scenarioPath, 'utf8')),
    DEFAULT_TEST_EMAIL.to.join(', '),
  );
  scenario.testEmail = { ...DEFAULT_TEST_EMAIL, ...scenario.testEmail, to: DEFAULT_TEST_EMAIL.to };
  if (scenario.autoApproveExternal && process.env.AX_ALLOW_LIVE_EXTERNAL_SEND !== '1') {
    console.log('[live-chat-batch] external sends remain pending; set AX_ALLOW_LIVE_EXTERNAL_SEND=1 for an explicit live-send run.');
  }
  const promptCount = scenario.steps.filter((step) => step.action === 'sendMessage').length;
  const directOutboundCount = Array.isArray(scenario.directOutboundChecks)
    ? scenario.directOutboundChecks.length
    : 0;
  if (promptCount === 0 && directOutboundCount === 0) throw new Error('실행할 테스트 단계가 비어 있습니다.');

  const jevKey = decryptSecret('TYPESAFE_API_KEY');
  if (jevKey) process.env.TYPESAFE_API_KEY = jevKey;
  process.env.AX_EXPERIMENT_JEV_DECISION_PLANE = '1';

  const core = await createAxStudioCore({
    dataRoot,
    decisionEngine: jevKey
      ? new JevDecisionEngine({ apiKey: jevKey, model: 'jev-latest', baseURL: 'https://api.typesafe.ai' })
      : undefined,
  });
  const calls = [];
  const commandCalls = [];
  const jevCalls = [];
  const llmCalls = [];
  const approvalEvents = [];
  let directOutboundResults = [];
  await hydrateConnectors(core);
  instrumentConnector(core, 'gmail', calls);
  instrumentConnector(core, 'slack', calls);
  instrumentCommandService(core, commandCalls);
  instrumentAgentHarness(core, llmCalls);

  const messages = [];
  const connections = core.store.getConnections();
  const connected = [...new Set(connections.filter((entry) => entry.connected).map((entry) => entry.connector))];
  console.log(`[live-chat-batch] scenario=${scenario.id} prompts=${promptCount}`);
  console.log(`[live-chat-batch] connected=${connected.join(',')}`);

  try {
    let promptIndex = 0;
    let chatIndex = 0;
    let chatLabel = 'default';
    let workspaceSessionId;
    for (const step of scenario.steps) {
      if (step.action === 'newChat') {
        messages.length = 0;
        chatIndex += 1;
        chatLabel = step.label || `chat-${chatIndex}`;
        workspaceSessionId = core.store.saveWorkspaceChat({ messages: [] }).id;
        console.log(`[live-chat-batch] newChat=${chatLabel}`);
        continue;
      }
      if (step.action !== 'sendMessage') continue;
      promptIndex += 1;
      const userMessage = step.text;
      const startedAt = Date.now();
      const beforeCalls = calls.length;
      const beforeCommands = commandCalls.length;
      const beforeJev = jevCalls.length;
      const beforeLlm = llmCalls.length;
      const beforeApprovals = new Set(core.store.getPendingApprovals().map((approval) => approval.id));
      messages.push({ role: 'user', content: userMessage });
      const operationSelection = buildJevReadOperationIndex(connections).select(userMessage);
      const reply = await runAxCommandChat({
        harness: core.agentHarness,
        commandService: core.commandService,
        decisionEngine: countedDecisionEngine(core.decisionEngine, jevCalls),
        connectedConnectors: connected,
        workspaceSessionId,
        readOperationHints: operationSelection.hints,
        readOperationCatalogSize: operationSelection.totalCount,
        readOperationCatalogMayBeBounded: operationSelection.catalogMayBeBounded,
        readOperationSelectionMode: operationSelection.mode,
        readOperationLexicalMatchedOperationCount: operationSelection.lexicalMatchedOperationCount,
        readOperationLexicalTopScore: operationSelection.lexicalTopScore,
        messages: messages.slice(0, -1),
        userMessage,
        designToolContextFactory: () => buildDesignToolContext(
          core.store.getConnections(),
          connected,
          {
            allowUntrustedData: true,
            connectors: core.runtime.connectors,
            discoveryMetadata: core.store.listDiscoveryMetadata(),
          },
        ),
        timeoutMs: 180_000,
      });
      messages.push({ role: 'assistant', content: reply });
      const approvals = await settleApprovals(core, scenario, beforeApprovals, userMessage);
      approvalEvents.push(...approvals.events);
      for (const event of approvals.events.filter((entry) => entry.status !== 'left_pending')) {
        messages.push({
          role: 'assistant',
          content: JSON.stringify({ kind: 'execution_result', status: event.status, executionId: event.executionId }),
        });
      }
      const apiCalls = calls.slice(beforeCalls);
      const promptCommands = commandCalls.slice(beforeCommands);
      const promptJev = jevCalls.slice(beforeJev);
      const promptLlm = llmCalls.slice(beforeLlm);
      console.log(JSON.stringify({
        index: promptIndex,
        chat: chatLabel,
        durationMs: Date.now() - startedAt,
        jevCalls: promptJev.length,
        jev: promptJev,
        llmCalls: promptLlm.length,
        llm: promptLlm,
        commandCalls: promptCommands,
        connectorCalls: apiCalls,
        approvals: approvals.events,
        pendingApprovalCount: approvals.pendingApprovalCount,
        replyPreview: reply.replace(/\s+/gu, ' ').slice(0, 300),
      }));
    }
    if (directOutboundCount > 0) {
      if (!workspaceSessionId) workspaceSessionId = core.store.saveWorkspaceChat({ messages: [] }).id;
      directOutboundResults = await runDirectOutboundChecks(
        core,
        scenario,
        workspaceSessionId,
        calls,
        commandCalls,
        approvalEvents,
      );
    }
  } finally {
    console.log(JSON.stringify({
      totalJevCalls: jevCalls.length,
      totalLlmCalls: llmCalls.length,
      totalCommandCalls: commandCalls.length,
      totalConnectorCalls: calls.length,
      totalApprovalEvents: approvalEvents.length,
      approvalEvents,
      pendingApprovalCount: core.store.getPendingApprovals().length,
      directOutboundResults,
      commandCalls,
      connectorCalls: calls,
    }));
    await core.agentHarness.dispose();
    core.db.close?.();
    app.quit();
  }
}

main().catch((error) => {
  console.error(`[live-chat-batch] ${error instanceof Error ? error.message : String(error)}`);
  app.quit();
  process.exitCode = 1;
});
