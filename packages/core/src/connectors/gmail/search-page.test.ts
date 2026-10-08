import type { gmail_v1 } from '@googleapis/gmail';
import { describe, expect, it, vi } from 'vitest';
import { localMailDate, searchGmailMessagePage } from './search-page.js';

function fakeGmail() {
  const get = vi.fn(async ({ id }: { id: string }) => ({ data: {
    id, snippet: ` 미리보기 ${id} `,
    payload: { headers: [{ name: 'From', value: '보낸이 <a@example.com>' }, { name: 'Subject', value: `제목 ${id}` }, { name: 'Date', value: 'Wed, 8 Oct 2026 09:00:00 +0900' }] },
  } }));
  const list = vi.fn(async () => ({ data: { messages: [{ id: 'm1', threadId: 't1' }, { id: 'm2', threadId: 't2' }] } }));
  return { gmail: { users: { messages: { list, get } } } as unknown as gmail_v1.Gmail, get };
}

describe('a page of Gmail search results', () => {
  it('says who sent each mail, its subject, date and preview without being asked', async () => {
    const { gmail } = fakeGmail();
    const page = await searchGmailMessagePage(gmail, { query: '' });
    expect(page.messages).toEqual([
      expect.objectContaining({ id: 'm1', from: '보낸이 <a@example.com>', subject: '제목 m1', snippet: '미리보기 m1' }),
      expect.objectContaining({ id: 'm2', subject: '제목 m2', date: localMailDate('Wed, 8 Oct 2026 09:00:00 +0900') }),
    ]);
  });

  it('lists ids only when asked to', async () => {
    const { gmail, get } = fakeGmail();
    const page = await searchGmailMessagePage(gmail, { query: '', includeMetadata: false });
    expect(page.messages).toEqual([{ id: 'm1', threadId: 't1' }, { id: 'm2', threadId: 't2' }]);
    expect(get).not.toHaveBeenCalled();
  });

  it('writes the date as local time that sorts, and leaves an unreadable one alone', () => {
    expect(localMailDate('Wed, 8 Oct 2026 09:00:00 +0900')).toMatch(/^2026-10-0[78] \d{2}:\d{2}$/u);
    expect(localMailDate('not a date')).toBe('not a date');
  });

  it('keeps reading the other mails while one is slow, and keeps the page order', async () => {
    const ids = Array.from({ length: 10 }, (_, index) => `m${index}`);
    let releaseSlow!: () => void;
    const slow = new Promise<void>((resolve) => { releaseSlow = resolve; });
    const started: string[] = [];
    const get = vi.fn(async ({ id }: { id: string }) => {
      started.push(id);
      if (id === 'm0') await slow;
      if (started.length === ids.length) releaseSlow();
      return { data: { id, payload: { headers: [{ name: 'Subject', value: `제목 ${id}` }] } } };
    });
    const list = vi.fn(async () => ({ data: { messages: ids.map((id) => ({ id })) } }));
    const gmail = { users: { messages: { list, get } } } as unknown as gmail_v1.Gmail;

    const page = await searchGmailMessagePage(gmail, { query: '' });

    expect(started).toHaveLength(10);
    expect(page.messages.map((message) => message.id)).toEqual(ids);
  });
});
