#!/usr/bin/env node

import { createHmac } from 'node:crypto';

const DEFAULT_URL = process.env.AX_MANUAL_WEBHOOK_URL ?? 'http://127.0.0.1:18789/hooks/invoice-paid';
const DEFAULT_SECRET = process.env.AX_MANUAL_WEBHOOK_SECRET ?? 'hook-secret';
const DEFAULT_EVENT_ID = process.env.AX_MANUAL_WEBHOOK_EVENT_ID ?? 'manual-invoice-paid-1';
const DEFAULT_BODY = process.env.AX_MANUAL_WEBHOOK_BODY ?? JSON.stringify({
  invoiceId: 'manual-1001',
  amount: 42_000,
  status: 'paid',
});
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function parseArgs(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--check') {
      result.check = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      result.help = true;
      continue;
    }
    if (!argument?.startsWith('--')) throw new Error(`알 수 없는 인자: ${argument ?? ''}`);
    const [rawName, ...inlineValue] = argument.slice(2).split('=');
    const name = rawName.replaceAll('-', '');
    const value = inlineValue.length > 0 ? inlineValue.join('=') : argv[++index];
    if (value === undefined || value.startsWith('--')) throw new Error(`값이 필요한 옵션입니다: --${rawName}`);
    result[name] = value;
  }
  return result;
}

function usage() {
  console.log(`AX Studio 로컬 Webhook 발신 도구

사용:
  npm run test:manual:webhook -- --url http://127.0.0.1:18789/hooks/invoice-paid --secret hook-secret

옵션:
  --url       AX Studio Webhook URL (loopback 주소만 허용)
  --secret    공유 비밀 또는 HMAC 서명용 비밀
  --auth      secret (기본값) 또는 hmac
  --event-id  provider event id (기본값: ${DEFAULT_EVENT_ID})
  --repeat    같은 event id를 보낼 횟수 (기본값: 2)
  --body      보낼 JSON 문자열
  --check     네트워크 요청 없이 도구 설정만 확인
`);
}

function validateUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Webhook URL 형식이 올바르지 않습니다.');
  }
  if (url.protocol !== 'http:') throw new Error('수동 도구는 로컬 http Webhook만 허용합니다.');
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error('안전상 loopback 주소(127.0.0.1/localhost/[::1])만 허용합니다.');
  }
  if (!url.pathname.startsWith('/hooks/') || url.pathname.slice('/hooks/'.length).length === 0) {
    throw new Error('URL 경로는 /hooks/{path} 형식이어야 합니다.');
  }
  if (url.username || url.password) throw new Error('Webhook URL에 사용자명이나 비밀번호를 넣을 수 없습니다.');
  return url;
}

function parseRepeat(value) {
  const repeat = Number(value ?? 2);
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20) {
    throw new Error('--repeat는 1부터 20 사이의 정수여야 합니다.');
  }
  return repeat;
}

function buildHeaders(auth, secret, eventId, body) {
  const headers = {
    'content-type': 'application/json',
    'idempotency-key': eventId,
  };
  if (auth === 'hmac') {
    headers['x-ax-signature'] = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    return headers;
  }
  if (auth !== 'secret') throw new Error('--auth는 secret 또는 hmac이어야 합니다.');
  headers['x-ax-webhook-secret'] = secret;
  return headers;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    return;
  }

  const url = validateUrl(args.url ?? DEFAULT_URL);
  const secret = String(args.secret ?? DEFAULT_SECRET).trim();
  if (!secret) throw new Error('Webhook 비밀이 비어 있습니다.');
  const eventId = String(args.eventid ?? DEFAULT_EVENT_ID).trim();
  if (!eventId) throw new Error('event id가 비어 있습니다.');
  const body = String(args.body ?? DEFAULT_BODY);
  const auth = String(args.auth ?? 'secret').toLowerCase();
  const repeat = parseRepeat(args.repeat);
  buildHeaders(auth, secret, eventId, body);

  if (args.check) {
    console.log(`[webhook] helper OK: ${url.pathname}, loopback-only, ${auth} auth`);
    return;
  }

  const headers = buildHeaders(auth, secret, eventId, body);
  console.log(`[webhook] sending ${repeat} delivery(ies) to ${url.origin}${url.pathname} with event id ${eventId}`);
  for (let attempt = 1; attempt <= repeat; attempt += 1) {
    const response = await fetch(url, { method: 'POST', headers, body });
    const responseBody = await response.text();
    console.log(`[webhook] delivery ${attempt}/${repeat}: ${response.status} ${responseBody}`);
    if (response.status !== 202) {
      throw new Error(`AX Studio가 Webhook을 수락하지 않았습니다: HTTP ${response.status}`);
    }
  }
  console.log('[webhook] accepted; Activity에서 동일 event id가 한 번만 실행됐는지 확인하세요.');
}

try {
  await main();
} catch (error) {
  console.error(`[webhook] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
