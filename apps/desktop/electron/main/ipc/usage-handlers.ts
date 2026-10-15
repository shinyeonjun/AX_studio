import { buildUsageReport, usagePeriodStart, type UsagePeriod } from '@ax-studio/core';
import { ipcHandle } from './ipc-handle.js';
import { getCore } from '../core-instance.js';

const PERIODS: readonly UsagePeriod[] = ['today', 'week', 'month'];

/** Usage screen: model calls of the period, summed per engine and per request. */
export function registerUsageHandlers() {
  ipcHandle('ax:getUsageReport', async (_event, raw: unknown) => {
    const period = PERIODS.includes(raw as UsagePeriod) ? (raw as UsagePeriod) : 'week';
    const since = usagePeriodStart(period);
    return buildUsageReport(getCore().store.usage.listUsageCallsSince(since), period, since);
  });
}
