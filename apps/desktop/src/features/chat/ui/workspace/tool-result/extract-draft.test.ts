import { describe, expect, it } from 'vitest';
import type { WorkspaceChatMessage, WorkspaceSourceRecord } from '@ax-studio/core';
import { extractDraftFromMessages, formatFileSize } from './extract-draft';

describe('extractDraftFromMessages', () => {
  it('extracts real Gmail draft fields from assistant message', () => {
    const messages: WorkspaceChatMessage[] = [
      { role: 'user', content: '김민지 팀장님께 결산 보고서 전달해줘' },
      {
        role: 'assistant',
        content: `김민지 팀장님께 발송할 메일 초안을 작성했습니다.

받는 사람: 김민지 <minji@example.com>
제목: [보고] 3분기 결산 보고서 완료 안내

안녕하세요, 김민지 팀장님.
요청하신 3분기 결산 보고서가 완료되었습니다.
첨부된 파일을 확인해 주시기 바랍니다.

감사합니다.

위 내용으로 발송할까요?`,
      },
    ];

    const result = extractDraftFromMessages('gmail', messages);
    expect(result.draft).toEqual({
      tool: 'gmail',
      to: '김민지 <minji@example.com>',
      subject: '[보고] 3분기 결산 보고서 완료 안내',
      body: `안녕하세요, 김민지 팀장님.
요청하신 3분기 결산 보고서가 완료되었습니다.
첨부된 파일을 확인해 주시기 바랍니다.

감사합니다.`,
    });
    expect(result.attachments).toEqual([]);
  });

  it('extracts recipient and subject from user prompt if assistant omits meta headers', () => {
    const messages: WorkspaceChatMessage[] = [
      { role: 'user', content: 'ceo@partner.com에게 "계약서 승인 요청" 제목으로 메일 써줘' },
      {
        role: 'assistant',
        content: '```\n안녕하세요 대표님,\n\n보내주신 최종 계약서 검토를 마쳤습니다.\n확인 후 회신 부탁드립니다.\n```',
      },
    ];

    const result = extractDraftFromMessages('gmail', messages);
    expect(result.draft.to).toBe('ceo@partner.com');
    expect(result.draft.subject).toBe('계약서 승인 요청');
    expect(result.draft.body).toContain('안녕하세요 대표님');
  });

  it('extracts real Slack channel and message from code block', () => {
    const messages: WorkspaceChatMessage[] = [
      { role: 'user', content: '#개발 채널에 빌드 완료 공지 올려줘' },
      {
        role: 'assistant',
        content: 'Slack #개발 채널에 올릴 공지 초안입니다.\n\n```\n[공지] v2.4.0 빌드 완료 안내\n\n• 주요 변경: 로그인 속도 최적화\n• 배포 일시: 금일 18:00\n```\n\n이대로 게시할까요?',
      },
    ];

    const result = extractDraftFromMessages('slack', messages);
    expect(result.draft).toEqual({
      tool: 'slack',
      channel: '#개발',
      text: `[공지] v2.4.0 빌드 완료 안내

• 주요 변경: 로그인 속도 최적화
• 배포 일시: 금일 18:00`,
    });
  });

  it('extracts real attachments from generatedPdf, generatedSpreadsheet, and workspaceSources', () => {
    const messages: WorkspaceChatMessage[] = [
      { role: 'user', content: '보고서 작성해줘' },
      {
        role: 'assistant',
        content: '보고서와 이메일을 준비했습니다.',
        generatedPdf: {
          artifactId: 'art-pdf-1',
          fileName: '2026_분기보고서.pdf',
          size: 1572864, // 1.5MB
          mimeType: 'application/pdf',
        },
        generatedSpreadsheet: {
          artifactId: 'art-sheet-1',
          fileName: '통계자료.xlsx',
          size: 512000,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      },
    ];

    const sources: WorkspaceSourceRecord[] = [
      {
        id: 'src-1',
        sessionId: 'sess-1',
        artifactId: 'art-src-1',
        fileName: '참고자료.pdf',
        status: 'ready',
        createdAt: '2026-10-06T00:00:00Z',
        updatedAt: '2026-10-06T00:00:00Z',
      },
    ];

    const result = extractDraftFromMessages('gmail', messages, sources);
    expect(result.attachments).toHaveLength(3);
    expect(result.attachments[0]).toEqual({ fileName: '2026_분기보고서.pdf', size: 1572864 });
    expect(result.attachments[1]).toEqual({ fileName: '통계자료.xlsx', size: 512000 });
    expect(result.attachments[2]).toEqual({ fileName: '참고자료.pdf' });
  });

  it('synthesizes real conversation data into Slack draft when assistant has channel selection prompt', () => {
    const messages: WorkspaceChatMessage[] = [
      {
        role: 'assistant',
        content: '가구 목록입니다.',
        readResult: {
          id: 'read-1',
          readScope: { table: 'furniture', offset: 0, limit: 10, queryFingerprint: 'fp-1' },
          columns: [{ name: 'title' }, { name: 'stock' }, { name: 'price' }],
          rows: [
            { index: 0, values: { title: 'Executive Chair', stock: 26, price: 499.99 } },
            { index: 1, values: { title: 'Bedside Table', stock: 64, price: 299.99 } },
          ],
          truncated: false,
        },
      },
      {
        role: 'assistant',
        content: '총 재고 수량은 **90개**, 평균 가격은 **399.99**입니다.',
      },
      {
        role: 'user',
        content: '방금 찾은 가구 재고 목록 요약해서 슬랙 메시지로 보내줘',
      },
      {
        role: 'assistant',
        content: '조회와 외부 공유에 사용할 연결과 채널을 선택해 주세요. 선택을 마치기 전까지 작업은 큐에 등록되지 않습니다.',
        inputRequests: [
          {
            id: 'req-slack-ch',
            label: 'Slack 채널',
            options: [
              { value: 'C0BR0DNN4LT', label: '#소셜' },
              { value: 'C0BR2U9RPHT', label: '#일반' },
            ],
          },
        ],
      },
    ];

    const result = extractDraftFromMessages('slack', messages);
    expect(result.draft.channel).toBe('#소셜');
    expect(result.draft.text).toContain('총 재고 수량은 **90개**');
    expect(result.draft.text).toContain('Executive Chair (재고: 26개, 가격: 499.99)');
    expect(result.draft.text).toContain('Bedside Table (재고: 64개, 가격: 299.99)');
  });

  it('formats file size human-readably', () => {
    expect(formatFileSize(500)).toBe('500 B');
    expect(formatFileSize(1500)).toBe('1.5 KB');
    expect(formatFileSize(1572864)).toBe('1.5 MB');
    expect(formatFileSize(undefined)).toBe('');
  });
});
