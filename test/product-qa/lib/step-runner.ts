import type { Page } from '@playwright/test';
import {
  attachFixtureViaE2e,
  clickNewChat,
  deleteSessionByTitle,
  errorBannerText,
  hasWorkflow,
  isAppAlive,
  isComposerDisabled,
  listSessionTitles,
  openAiSettings,
  openContextTab,
  openSettingsLink,
  openSidebarTab,
  pageTitleText,
  publishDiscovery,
  readVisibleMessages,
  startDiscoveryFixture,
  sendMessage,
  switchSessionByTitle,
  toggleTheme,
  waitForDiscoveryStatus,
  waitForComposerBusy,
  waitForComposerReady,
} from './ui.js';
import type {
  DefectRecord,
  DefectSeverity,
  ProductQaMode,
  ProductScenario,
  ScenarioRunResult,
  ScenarioStep,
  StepMetric,
} from './types.js';
import { defaultReplyTimeoutMs, fixturePath, type DesktopContext } from './desktop-app.js';

interface SessionState {
  label: string;
  titleHint?: string;
}

export class StepRunner {
  private sessions = new Map<string, SessionState>();
  private activeLabel?: string;
  private replyLatenciesMs: number[] = [];

  constructor(
    private readonly ctx: DesktopContext,
    private readonly scenario: ProductScenario,
    private readonly runIndex: number,
    private readonly strict: boolean,
  ) {}

  async run(): Promise<ScenarioRunResult> {
    const startedAt = new Date();
    const steps: StepMetric[] = [];
    const defects: DefectRecord[] = [];
    let error: string | undefined;

    try {
      for (let index = 0; index < this.scenario.steps.length; index += 1) {
        const step = this.scenario.steps[index]!;
        const stepStarted = Date.now();
        try {
          if ('action' in step) {
            await this.runAction(this.ctx.page, step);
            steps.push({
              stepIndex: index,
              step,
              startedAt: new Date(stepStarted).toISOString(),
              durationMs: Date.now() - stepStarted,
              ok: true,
            });
          } else {
            const defect = await this.runCheck(this.ctx.page, step, index);
            defects.push(defect);
            steps.push({
              stepIndex: index,
              step,
              startedAt: new Date(stepStarted).toISOString(),
              durationMs: Date.now() - stepStarted,
              ok: defect.passed,
              detail: defect.passed ? undefined : defect.actual,
            });
            if (!defect.passed && this.strict) {
              throw new Error(`${defect.check}: ${defect.actual}`);
            }
          }
        } catch (stepError) {
          const message = stepError instanceof Error ? stepError.message : String(stepError);
          steps.push({
            stepIndex: index,
            step,
            startedAt: new Date(stepStarted).toISOString(),
            durationMs: Date.now() - stepStarted,
            ok: false,
            detail: message,
          });
          throw stepError;
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const finishedAt = new Date();
    const passed = !error && defects.every((d) => d.passed);

    return {
      scenarioId: this.scenario.id,
      scenarioName: this.scenario.name,
      mode: this.scenario.mode ?? this.ctx.mode,
      runIndex: this.runIndex,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      steps,
      defects,
      passed,
      error,
      covers: this.scenario.covers,
      generated: this.scenario.generated,
    };
  }

  getReplyLatencies(): number[] {
    return [...this.replyLatenciesMs];
  }

  private async runAction(page: Page, step: Extract<ScenarioStep, { action: string }>): Promise<void> {
    switch (step.action) {
      case 'newChat': {
        await clickNewChat(page);
        if (step.label) {
          this.activeLabel = step.label;
          this.sessions.set(step.label, { label: step.label });
        }
        return;
      }
      case 'sendMessage': {
        const label = step.label ?? this.activeLabel;
        const waitForReply = step.waitForReply !== false;
        const sendStarted = Date.now();
        await sendMessage(page, step.text);
        if (label) this.sessions.set(label, { label, titleHint: step.text.slice(0, 40) });
        if (!waitForReply) return;
        try {
          await waitForComposerBusy(page, 5_000);
        } catch {
          // fast deterministic replies may skip visible busy state
        }
        await waitForComposerReady(page, defaultReplyTimeoutMs());
        this.replyLatenciesMs.push(Date.now() - sendStarted);
        await this.captureSessionTitle(page, label);
        return;
      }
      case 'waitMs': {
        await page.waitForTimeout(step.ms);
        return;
      }
      case 'waitForAssistantReply': {
        const timeoutMs = step.timeoutMs ?? defaultReplyTimeoutMs();
        try {
          await waitForComposerReady(page, timeoutMs);
        } catch (err) {
          if (step.optional) return;
          throw err;
        }
        return;
      }
      case 'startDiscoveryFixture': {
        await startDiscoveryFixture(page, fixturePath(step.artifact), fixturePath(step.folder));
        return;
      }
      case 'waitForDiscovery': {
        await waitForDiscoveryStatus(page, step.status, step.timeoutMs ?? 30_000);
        return;
      }
      case 'publishDiscovery': {
        await publishDiscovery(page);
        return;
      }
      case 'switchSession': {
        const title =
          step.titleContains ??
          (step.label ? this.sessions.get(step.label)?.titleHint : undefined) ??
          step.label;
        if (!title) throw new Error('switchSession requires label or titleContains');
        await switchSessionByTitle(page, title);
        await page.waitForTimeout(400);
        if (step.label) this.activeLabel = step.label;
        return;
      }
      case 'attachFixture': {
        const path = fixturePath(step.fixture);
        await attachFixtureViaE2e(page, path);
        if (step.label) this.activeLabel = step.label;
        return;
      }
      case 'screenshot': {
        await page.screenshot({
          path: `${this.ctx.artifactDir}/screenshots/${this.scenario.id}-run${this.runIndex}-${step.name}.png`,
          fullPage: true,
        });
        return;
      }
      case 'deleteSession': {
        const title =
          step.titleContains ??
          (step.label ? this.sessions.get(step.label)?.titleHint : undefined) ??
          step.label;
        if (!title) throw new Error('deleteSession requires label or titleContains');
        await deleteSessionByTitle(page, title);
        await page.waitForTimeout(300);
        return;
      }
      case 'openTab': {
        await openSidebarTab(page, step.tab);
        await page.waitForTimeout(200);
        return;
      }
      case 'openSettings': {
        await openSidebarTab(page, 'settings');
        await openSettingsLink(page, step.label);
        await page.waitForTimeout(200);
        return;
      }
      case 'openAiSettings': {
        await openSidebarTab(page, 'settings');
        await openAiSettings(page, step.brand);
        await page.waitForTimeout(200);
        return;
      }
      case 'toggleTheme': {
        await toggleTheme(page);
        return;
      }
      case 'openContextTab': {
        await openContextTab(page, step.tab);
        await page.waitForTimeout(200);
        return;
      }
      default:
        throw new Error(`Unknown action: ${(step as { action: string }).action}`);
    }
  }

  private async captureSessionTitle(page: Page, label?: string): Promise<void> {
    if (!label) return;
    const titles = await listSessionTitles(page);
    const state = this.sessions.get(label);
    if (!state || titles.length === 0) return;
    const hint = state.titleHint?.slice(0, 20);
    const matched = hint ? titles.find((title) => title.includes(hint)) : titles[0];
    if (matched) this.sessions.set(label, { ...state, titleHint: matched });
  }

  private async runCheck(
    page: Page,
    step: Extract<ScenarioStep, { check: string }>,
    stepIndex: number,
  ): Promise<DefectRecord> {
    const severity: DefectSeverity = step.severity ?? 'critical';
    const base = {
      scenarioId: this.scenario.id,
      scenarioName: this.scenario.name,
      runIndex: this.runIndex,
      stepIndex,
      severity,
    };

    switch (step.check) {
      case 'assistantMessageContains': {
        const messages = await readVisibleMessages(page);
        const assistants = messages.filter((m) => m.role === 'assistant').map((m) => m.text).join('\n');
        const passed = assistants.includes(step.text);
        return {
          ...base,
          check: step.check,
          expected: `assistant contains ${step.text}`,
          actual: passed ? 'matched' : `assistant text: ${assistants.slice(0, 500)}`,
          passed,
        };
      }
      case 'userMessagePresent': {
        const messages = await readVisibleMessages(page);
        const passed = messages.some((m) => m.role === 'user' && m.text.includes(step.text));
        return {
          ...base,
          check: step.check,
          expected: `user message contains ${step.text}`,
          actual: passed ? 'matched' : `messages: ${JSON.stringify(messages).slice(0, 500)}`,
          passed,
        };
      }
      case 'sessionCountAtLeast': {
        const titles = await listSessionTitles(page);
        const passed = titles.length >= step.min;
        return {
          ...base,
          check: step.check,
          expected: `>= ${step.min} sessions`,
          actual: `${titles.length} sessions: ${titles.join(', ')}`,
          passed,
        };
      }
      case 'noCrossSessionBleed': {
        const session = this.sessions.get(step.forbiddenInSession);
        if (session?.titleHint) await switchSessionByTitle(page, session.titleHint);
        const messages = await readVisibleMessages(page);
        const blob = messages.map((m) => m.text).join('\n');
        const passed = !blob.includes(step.text);
        return {
          ...base,
          check: step.check,
          expected: `session ${step.forbiddenInSession} must not contain ${step.text}`,
          actual: passed ? 'clean' : `found forbidden text in: ${blob.slice(0, 500)}`,
          passed,
        };
      }
      case 'composerEnabled': {
        const disabled = await isComposerDisabled(page);
        return {
          ...base,
          check: step.check,
          expected: 'composer enabled',
          actual: disabled ? 'disabled' : 'enabled',
          passed: !disabled,
        };
      }
      case 'composerDisabled': {
        const disabled = await isComposerDisabled(page);
        return {
          ...base,
          check: step.check,
          expected: 'composer disabled',
          actual: disabled ? 'disabled' : 'enabled',
          passed: disabled,
        };
      }
      case 'assistantNonEmpty': {
        const messages = await readVisibleMessages(page);
        const assistants = messages.filter((m) => m.role === 'assistant').map((m) => m.text).join('\n').trim();
        const minChars = step.minChars ?? 1;
        const passed = assistants.length >= minChars;
        return {
          ...base,
          check: step.check,
          expected: `assistant length >= ${minChars}`,
          actual: passed ? `length ${assistants.length}` : `assistant text: ${assistants.slice(0, 500)}`,
          passed,
        };
      }
      case 'visibleTextContains': {
        const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
        const passed = body.includes(step.text);
        return {
          ...base,
          check: step.check,
          expected: `visible text contains ${step.text}`,
          actual: passed ? 'matched' : `missing ${step.text}`,
          passed,
        };
      }
      case 'visibleTextAbsent': {
        const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
        const passed = !body.includes(step.text);
        return {
          ...base,
          check: step.check,
          expected: `visible text must not contain ${step.text}`,
          actual: passed ? 'absent' : `found ${step.text}`,
          passed,
        };
      }
      case 'pageTitleIs': {
        const title = await pageTitleText(page);
        const passed = title === step.text;
        return {
          ...base,
          check: step.check,
          expected: step.text,
          actual: title,
          passed,
        };
      }
      case 'noErrorBanner': {
        const text = await errorBannerText(page);
        return {
          ...base,
          check: step.check,
          expected: 'no error banner',
          actual: text || 'none',
          passed: !text,
        };
      }
      case 'appAlive': {
        const alive = await isAppAlive(page);
        return {
          ...base,
          check: step.check,
          expected: 'new chat button visible',
          actual: alive ? 'alive' : 'missing new chat',
          passed: alive,
        };
      }
      case 'discoveryCardPresent':
      case 'discoveryCardAbsent': {
        const visible = await page.locator('.ax-discovery-review').isVisible().catch(() => false);
        const passed = step.check === 'discoveryCardPresent' ? visible : !visible;
        return {
          ...base,
          check: step.check,
          expected: step.check === 'discoveryCardPresent' ? 'Discovery review card visible' : 'Discovery review card absent',
          actual: visible ? 'visible' : 'absent',
          passed,
        };
      }
      case 'workflowPresent': {
        const present = await hasWorkflow(page, step.text);
        return {
          ...base,
          check: step.check,
          expected: `workflow name contains ${step.text}`,
          actual: present ? 'matched' : 'workflow not found',
          passed: present,
        };
      }
      default:
        throw new Error(`Unknown check: ${(step as { check: string }).check}`);
    }
  }
}

export async function runScenario(
  ctx: DesktopContext,
  scenario: ProductScenario,
  runIndex: number,
  strict: boolean,
): Promise<{ result: ScenarioRunResult; replyLatenciesMs: number[] }> {
  const runner = new StepRunner(ctx, scenario, runIndex, strict);
  const result = await runner.run();
  return { result, replyLatenciesMs: runner.getReplyLatencies() };
}
