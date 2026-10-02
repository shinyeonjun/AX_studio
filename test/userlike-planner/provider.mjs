import { ProxyAgent, fetch } from 'undici';
import { JevDecisionEngine } from '../../packages/core/dist/intelligence/decision/jev.js';
import { openProviderBudget } from './budget.mjs';

export async function recordResponseUsage(response, metrics) {
  let usageRecorded = false;
  const reader = response.clone().body?.getReader();
  try {
    const chunks = []; let size = 0;
    if (reader) while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > 1_048_576) { void reader.cancel().catch(() => {}); throw new Error('response_limit'); }
      chunks.push(Buffer.from(next.value));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const usage = body.usage;
    if (Number.isSafeInteger(usage?.input_tokens) && usage.input_tokens >= 0 && Number.isSafeInteger(usage?.output_tokens) && usage.output_tokens >= 0) {
      metrics.inputTokens += usage.input_tokens; metrics.outputTokens += usage.output_tokens; usageRecorded = true;
    }
    if (typeof body.model === 'string' && body.model.length <= 100 && !metrics.models.includes(body.model)) metrics.models.push(body.model);
  } catch { /* Missing provider usage is explicitly unknown, never invented. */ }
  finally { reader?.releaseLock(); if (!usageRecorded) metrics.usageMissingResponses++; }
}

export function liveProvider(ledgerPath, batchLimit = 8) {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key || !process.env.HTTPS_PROXY) throw new Error('missing_environment_binding');
  const dispatcher = new ProxyAgent(process.env.HTTPS_PROXY);
  const budget = openProviderBudget(ledgerPath, batchLimit);
  const ledger = budget.state;
  const metrics = { evaluations: 0, http: 0, bytes: 0, inputTokens: 0, outputTokens: 0, models: [], statuses: [], decisions: [], blockedAttempts: 0, usageMissingResponses: 0 };
  const engine = new JevDecisionEngine({ apiKey: key, baseURL: 'https://api.typesafe.ai', fetch: async (url, init) => {
    try { if (url !== 'https://api.typesafe.ai/v1/systemone') throw new Error('provider_origin_denied'); budget.reserve(); }
    catch(error) { metrics.blockedAttempts++; throw error; }
    metrics.http++; metrics.bytes += Buffer.byteLength(init.body);
    const response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${key}` }, dispatcher, redirect: 'error' });
    metrics.statuses.push(response.status);
    if (response.status === 401 || response.status === 403) budget.blockAuth();
    await recordResponseUsage(response, metrics);
    return response;
  } });
  return { metrics, ledger, close: async () => { try { await dispatcher.close(); } finally { budget.close(); } }, engine: { dataHandling: 'cloud', async evaluate(request) {
    metrics.evaluations++;
    const result = await engine.evaluate(request);
    metrics.decisions.push(Object.fromEntries(Object.entries(result.answers).filter(([id]) => id === "route" || id === "requirements" || id === "scope" || id === "needs_natural_language_answer" || id.startsWith("tool_")).map(([id,a]) => [id, a.type === "choice" ? a.choice : a.type === "boolean" ? a.probability : "score"])));
    return result;
  } } };
}
