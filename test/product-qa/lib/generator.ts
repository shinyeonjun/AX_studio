import { PRODUCT_SURFACES, type ProductSurface } from '../catalog/product-surface.js';
import type {
  ProductQaMode,
  ProductQaTier,
  ProductScenario,
  ScenarioStep,
} from './types.js';

export interface GenerateOptions {
  mode: ProductQaMode;
  tier: ProductQaTier;
  max: number;
  allowSideEffects: boolean;
  seed?: number;
}

const TIER_RANK: Record<ProductQaTier, number> = {
  handwritten: 0,
  smoke: 1,
  core: 2,
  full: 3,
  soak: 4,
};

function includesTier(itemTier: ProductQaTier, requested: ProductQaTier): boolean {
  return TIER_RANK[itemTier] <= TIER_RANK[requested];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function survivalChecks(): ScenarioStep[] {
  return [
    { check: 'appAlive', severity: 'critical' },
    { check: 'noErrorBanner', severity: 'major' },
  ];
}

function promptScenario(
  surface: ProductSurface,
  mode: ProductQaMode,
  tier: ProductQaTier,
): ProductScenario {
  const marker = `QA_${surface.id.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40)}`;
  const text =
    mode === 'deterministic'
      ? `${marker} ${surface.title}`
      : `${surface.prompt} (marker ${marker})`;
  return {
    id: `gen-${surface.id}`,
    name: surface.title,
    description: surface.prompt || surface.title,
    mode,
    generated: true,
    tier,
    tags: ['generated', surface.area, tier, surface.sideEffect === 'write' ? 'side-effect' : 'safe'],
    covers: [surface.id],
    timeoutMs: mode === 'live' ? 180_000 : 60_000,
    steps: [
      { action: 'openTab', tab: 'work' },
      { action: 'newChat', label: surface.id },
      { action: 'sendMessage', text, label: surface.id },
      { action: 'waitForAssistantReply', timeoutMs: mode === 'live' ? 180_000 : 20_000 },
      { check: 'userMessagePresent', text: marker, severity: 'critical' },
      { check: 'assistantNonEmpty', minChars: 1, severity: 'critical' },
      { check: 'composerEnabled', severity: 'major' },
      ...survivalChecks(),
    ],
  };
}

function navScenario(surface: ProductSurface, mode: ProductQaMode): ProductScenario {
  const steps: ScenarioStep[] = [];
  if (surface.nav?.tab) steps.push({ action: 'openTab', tab: surface.nav.tab });
  if (surface.nav?.settingsLabel) steps.push({ action: 'openSettings', label: surface.nav.settingsLabel });
  if (surface.nav?.aiBrand) steps.push({ action: 'openAiSettings', brand: surface.nav.aiBrand });
  if (surface.nav?.pageTitle) {
    steps.push({ check: 'pageTitleIs', text: surface.nav.pageTitle, severity: 'critical' });
  }
  if (surface.id === 'settings:hidden-openapi-mcp') {
    steps.push({ check: 'visibleTextAbsent', text: 'OpenAPI 연결', severity: 'major' });
    steps.push({ check: 'visibleTextAbsent', text: 'MCP 연결', severity: 'major' });
  }
  steps.push(...survivalChecks());
  return {
    id: `gen-${surface.id}`,
    name: surface.title,
    mode,
    generated: true,
    tier: 'smoke',
    tags: ['generated', 'nav', 'smoke'],
    covers: [surface.id],
    timeoutMs: 60_000,
    steps,
  };
}

function documentScenario(mode: ProductQaMode): ProductScenario {
  const attach = mode === 'deterministic';
  return {
    id: 'gen-document:session-pdf',
    name: '세션 PDF 자료',
    mode,
    generated: true,
    tier: 'core',
    tags: ['generated', 'document', 'core'],
    covers: ['document:session-pdf', 'capability:document.ingest'],
    timeoutMs: mode === 'live' ? 180_000 : 90_000,
    steps: [
      { action: 'openTab', tab: 'work' },
      { action: 'newChat', label: 'pdf' },
      { action: 'openContextTab', tab: '자료' },
      { check: 'visibleTextContains', text: 'PDF 자료', severity: 'major' },
      ...(attach
        ? ([
            { action: 'attachFixture', fixture: 'sample.pdf', label: 'pdf' },
            { action: 'waitMs', ms: 800 },
            { action: 'sendMessage', text: '__e2e:source-read__' },
            { action: 'waitForAssistantReply', timeoutMs: 20_000 },
            { check: 'assistantMessageContains', text: 'E2E source_read_ok', severity: 'critical' },
          ] as ScenarioStep[])
        : ([
            { action: 'sendMessage', text: '이 대화에 올린 PDF가 있으면 파일 이름만 말해. 없으면 없다고 해.' },
            { action: 'waitForAssistantReply', timeoutMs: 180_000 },
            { check: 'assistantNonEmpty', minChars: 1, severity: 'critical' },
          ] as ScenarioStep[])),
      { check: 'composerEnabled', severity: 'major' },
      ...survivalChecks(),
    ],
  };
}

function isolationScenario(mode: ProductQaMode): ProductScenario {
  const a = mode === 'deterministic' ? 'QA_SESSION_A keep this' : 'QA_SESSION_A: SESSION_A_OK 만 답해. 한 문장.';
  const b = mode === 'deterministic' ? 'QA_SESSION_B second chat' : 'QA_SESSION_B: SESSION_B_OK 만 답해. 한 문장.';
  const aReply = mode === 'deterministic' ? 'QA-SESSION-A' : 'SESSION_A_OK';
  return {
    id: 'gen-session:new-while-sending',
    name: '전송 중 새 대화',
    mode,
    generated: true,
    tier: 'core',
    tags: ['generated', 'session', 'defect-hunt'],
    covers: ['session:new-while-sending'],
    timeoutMs: mode === 'live' ? 240_000 : 90_000,
    steps: [
      { action: 'openTab', tab: 'work' },
      { action: 'newChat', label: 'sessionA' },
      { action: 'sendMessage', label: 'sessionA', waitForReply: false, text: a },
      { action: 'waitMs', ms: 600 },
      { action: 'newChat', label: 'sessionB' },
      { action: 'sendMessage', label: 'sessionB', text: b },
      { action: 'waitForAssistantReply', timeoutMs: mode === 'live' ? 180_000 : 20_000 },
      { action: 'switchSession', label: 'sessionA' },
      { action: 'waitForAssistantReply', timeoutMs: 8_000, optional: true },
      { check: 'userMessagePresent', text: 'QA_SESSION_A', severity: 'critical' },
      { check: 'assistantMessageContains', text: aReply, severity: 'critical' },
      { check: 'sessionCountAtLeast', min: 2, severity: 'major' },
      ...survivalChecks(),
    ],
  };
}

function deleteSessionScenario(mode: ProductQaMode): ProductScenario {
  return {
    id: 'gen-session:delete',
    name: '대화 삭제',
    mode,
    generated: true,
    tier: 'core',
    tags: ['generated', 'session'],
    covers: ['chat:new-send-reply'],
    timeoutMs: 60_000,
    steps: [
      { action: 'openTab', tab: 'work' },
      { action: 'newChat', label: 'toDelete' },
      {
        action: 'sendMessage',
        label: 'toDelete',
        text: mode === 'deterministic' ? 'QA_DELETE_ME hello' : 'QA_DELETE_ME 한 단어만 답해: OK',
      },
      { action: 'waitForAssistantReply', timeoutMs: mode === 'live' ? 120_000 : 20_000 },
      { action: 'deleteSession', label: 'toDelete' },
      { check: 'appAlive', severity: 'critical' },
      ...survivalChecks(),
    ],
  };
}

function themeScenario(mode: ProductQaMode): ProductScenario {
  return {
    id: 'gen-nav:theme',
    name: '테마 토글',
    mode,
    generated: true,
    tier: 'smoke',
    tags: ['generated', 'nav'],
    covers: ['nav:work'],
    timeoutMs: 30_000,
    steps: [
      { action: 'toggleTheme' },
      { action: 'waitMs', ms: 200 },
      { action: 'toggleTheme' },
      ...survivalChecks(),
    ],
  };
}

const SOAK_OPS = ['send', 'newChat', 'switch', 'openSettings', 'openActivity'] as const;

function soakScenario(index: number, rng: () => number, mode: ProductQaMode): ProductScenario {
  const length = 3 + Math.floor(rng() * 4);
  const steps: ScenarioStep[] = [{ action: 'openTab', tab: 'work' }, { action: 'newChat', label: 'soak0' }];
  let sessionCount = 1;
  let sent = false;
  for (let i = 0; i < length; i += 1) {
    const op = SOAK_OPS[Math.floor(rng() * SOAK_OPS.length)]!;
    if (op === 'send') {
      sent = true;
      steps.push({
        action: 'sendMessage',
        text: `QA_SOAK_${index}_${i} ping`,
        waitForReply: true,
      });
    } else if (op === 'newChat') {
      sessionCount += 1;
      steps.push({ action: 'newChat', label: `soak${sessionCount}` });
    } else if (op === 'switch' && sent) {
      steps.push({ action: 'switchSession', titleContains: 'QA_SOAK' });
    } else if (op === 'openSettings') {
      steps.push({ action: 'openTab', tab: 'settings' }, { action: 'openSettings', label: '설정 홈' });
      steps.push({ action: 'openTab', tab: 'work' });
    } else {
      steps.push({ action: 'openTab', tab: 'activity' }, { action: 'openTab', tab: 'work' });
    }
  }
  steps.push({ check: 'composerEnabled', severity: 'major' }, ...survivalChecks());
  return {
    id: `gen-soak-${index}`,
    name: `무작위 사용 경로 #${index}`,
    mode,
    generated: true,
    tier: 'soak',
    tags: ['generated', 'soak', 'chat'],
    covers: ['chat:new-send-reply', 'nav:work'],
    timeoutMs: 120_000,
    steps,
  };
}

export function generateScenarios(options: GenerateOptions): ProductScenario[] {
  if (options.tier === 'handwritten') return [];

  const out: ProductScenario[] = [];
  const navSurfaces = PRODUCT_SURFACES.filter((s) => s.nav);
  const promptSurfaces = PRODUCT_SURFACES.filter(
    (s) =>
      s.productReady &&
      s.prompt &&
      !s.nav &&
      s.id !== 'session:new-while-sending' &&
      s.id !== 'document:session-pdf' &&
      (options.allowSideEffects || s.sideEffect === 'none'),
  );

  if (includesTier('smoke', options.tier)) {
    out.push(themeScenario(options.mode));
    for (const surface of navSurfaces) out.push(navScenario(surface, options.mode));
  }

  if (includesTier('core', options.tier)) {
    out.push(isolationScenario(options.mode));
    out.push(deleteSessionScenario(options.mode));
    out.push(documentScenario(options.mode));
    for (const surface of promptSurfaces) {
      out.push(promptScenario(surface, options.mode, 'core'));
    }
  }

  if (includesTier('full', options.tier) || includesTier('soak', options.tier)) {
    const combos = [
      ['new', 'send', 'new', 'send'],
      ['new', 'send', 'settings', 'work', 'send'],
      ['new', 'send', 'activity', 'approval', 'work'],
      ['settings-gmail', 'work', 'send'],
      ['settings-slack', 'work', 'send'],
      ['settings-rdb', 'work', 'send'],
    ] as const;
    combos.forEach((combo, index) => {
      const steps: ScenarioStep[] = [{ action: 'openTab', tab: 'work' }];
      combo.forEach((op, opIndex) => {
        if (op === 'new') steps.push({ action: 'newChat', label: `full${index}-${opIndex}` });
        else if (op === 'send') {
          steps.push({
            action: 'sendMessage',
            text: `QA_FULL_${index}_${opIndex} ${options.mode === 'live' ? '한 단어 OK만' : 'ping'}`,
          });
        } else if (op === 'settings') {
          steps.push({ action: 'openTab', tab: 'settings' }, { action: 'openSettings', label: '설정 홈' });
        } else if (op === 'work') steps.push({ action: 'openTab', tab: 'work' });
        else if (op === 'activity') steps.push({ action: 'openTab', tab: 'activity' });
        else if (op === 'approval') steps.push({ action: 'openTab', tab: 'approval' });
        else if (op.startsWith('settings-')) {
          const label =
            op === 'settings-gmail' ? 'Gmail' : op === 'settings-slack' ? 'Slack' : '데이터베이스';
          steps.push({ action: 'openTab', tab: 'settings' }, { action: 'openSettings', label });
        }
      });
      steps.push({ check: 'composerEnabled', severity: 'major' }, ...survivalChecks());
      out.push({
        id: `gen-full-path-${index}`,
        name: `실제 사용 경로 ${combo.join(' → ')}`,
        mode: options.mode,
        generated: true,
        tier: 'full',
        tags: ['generated', 'full', 'path'],
        covers: ['chat:new-send-reply', 'nav:settings'],
        timeoutMs: options.mode === 'live' ? 240_000 : 90_000,
        steps,
      });
    });
  }

  if (options.tier === 'soak') {
    const rng = mulberry32(options.seed ?? 20260825);
    const remaining = Math.max(0, options.max - out.length);
    for (let i = 0; i < remaining; i += 1) {
      out.push(soakScenario(i, rng, options.mode));
    }
  }

  return out.slice(0, options.max);
}

export function defaultMaxForTier(tier: ProductQaTier): number {
  if (tier === 'handwritten') return 50;
  if (tier === 'smoke') return 50;
  if (tier === 'core') return 300;
  if (tier === 'full') return 2_000;
  return 10_000;
}
