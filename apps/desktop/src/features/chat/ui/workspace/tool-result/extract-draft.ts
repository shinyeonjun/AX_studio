import type { MessageToolDraft, WorkspaceChatMessage, WorkspaceSourceRecord } from '@ax-studio/core';

export interface ExtractedDraftResult {
  draft: MessageToolDraft;
  attachments: Array<{ fileName: string; size?: number }>;
}

export function formatFileSize(bytes?: number): string {
  if (typeof bytes !== 'number' || isNaN(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function cleanMarkdown(text: string): string {
  return text
    .replace(/^[*_~`]+|[*_~`]+$/g, '')
    .replace(/^\s*[:：]\s*/, '')
    .trim();
}

export function isSystemOrchestrationMessage(text: string): boolean {
  if (!text) return true;
  const systemPatterns = [
    /조회와\s*외부\s*공유에\s*사용할\s*연결과\s*채널/i,
    /작업은\s*큐에\s*등록되지\s*않습니다/i,
    /요청을\s*확실히\s*판단하지\s*못해/i,
    /원하는\s*결과와\s*대상을\s*조금\s*더\s*구체적으로/i,
    /요구\s*충족\s*또는\s*요청\s*범위를\s*확인하지\s*못했습니다/i,
    /아무\s*작업도\s*큐에\s*등록하지\s*않았습니다/i,
    /필터에\s*사용할\s*열과\s*기준값을\s*구체적으로/i,
    /실행\s*완료나\s*승인이\s*아닙니다/i,
    /연결을\s*선택해\s*주세요/i,
  ];
  return systemPatterns.some(p => p.test(text));
}

export function extractRealDataSummary(messages: WorkspaceChatMessage[]): {
  dataSummary: string;
  tableItems: string[];
} {
  let dataSummary = '';
  const tableItems: string[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant' && !isSystemOrchestrationMessage(m.content)) {
      const trimmed = m.content.trim();
      if (trimmed.length > 0 && !dataSummary) {
        dataSummary = trimmed;
      }
    }
    if (m.readResult && m.readResult.rows?.length > 0 && tableItems.length === 0) {
      const rows = m.readResult.rows.slice(0, 5);
      for (const row of rows) {
        const v = row.values;
        const title = v.title || v.name || v.productName || v.item || Object.values(v)[1] || Object.values(v)[0];
        const stock = v.stock !== undefined ? `재고: ${v.stock}개` : '';
        const price = v.price !== undefined ? `가격: ${typeof v.price === 'number' ? v.price.toLocaleString() : v.price}` : '';
        const details = [stock, price].filter(Boolean).join(', ');
        if (title) {
          tableItems.push(details ? `• ${title} (${details})` : `• ${title}`);
        }
      }
    }
  }

  return { dataSummary, tableItems };
}

export function extractDraftFromMessages(
  tool: 'gmail' | 'slack',
  messages: WorkspaceChatMessage[],
  workspaceSources?: WorkspaceSourceRecord[]
): ExtractedDraftResult {
  const assistant = [...messages].reverse().find(m => m.role === 'assistant');
  const user = [...messages].reverse().find(m => m.role === 'user');

  const assistantContent = assistant?.content ?? '';
  const userContent = user?.content ?? '';

  // 1. Extract Attachments
  const attachments: Array<{ fileName: string; size?: number }> = [];
  if (assistant?.generatedPdf) {
    attachments.push({
      fileName: assistant.generatedPdf.fileName,
      size: assistant.generatedPdf.size,
    });
  }
  if (assistant?.generatedSpreadsheet) {
    attachments.push({
      fileName: assistant.generatedSpreadsheet.fileName,
      size: assistant.generatedSpreadsheet.size,
    });
  }
  if (workspaceSources && workspaceSources.length > 0) {
    for (const src of workspaceSources) {
      if (src.status === 'ready' || src.fileName) {
        if (!attachments.some(a => a.fileName === src.fileName)) {
          attachments.push({ fileName: src.fileName });
        }
      }
    }
  }

  const { dataSummary, tableItems } = extractRealDataSummary(messages);

  if (tool === 'gmail') {
    // 2. Extract Gmail 'to'
    let to = '';
    const toMatchAssistant = assistantContent.match(/(?:받는\s*사람|수신자?|To)\s*[:：]\s*([^\n\r]+)/i);
    if (toMatchAssistant && toMatchAssistant[1]) {
      to = cleanMarkdown(toMatchAssistant[1]);
    } else {
      const emailAssistant = assistantContent.match(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/);
      if (emailAssistant) {
        to = emailAssistant[0];
      } else {
        const userToMatch = userContent.match(/([가-힣\w\s]+<[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+>|[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/);
        if (userToMatch && userToMatch[1]) {
          to = userToMatch[1].trim();
        }
      }
    }

    // 3. Extract Gmail 'subject'
    let subject = '';
    const subjMatchAssistant = assistantContent.match(/(?:제목|Subject)\s*[:：]\s*([^\n\r]+)/i);
    if (subjMatchAssistant && subjMatchAssistant[1]) {
      subject = cleanMarkdown(subjMatchAssistant[1]);
    } else {
      const subjMatchUser = userContent.match(/(?:제목(?:은|을)?\s*[:：]?\s*['"「[](.*?)['"」\]]|['"「[](.*?)['"」\]]\s*제목)/);
      if (subjMatchUser) {
        const val = subjMatchUser[1] || subjMatchUser[2];
        if (val) subject = cleanMarkdown(val);
      } else {
        if (/발주|주문/i.test(userContent)) {
          const itemMatch = userContent.match(/([가-힣\w]+)\s*(?:재고|발주)/);
          const item = itemMatch ? itemMatch[1] : '품목';
          subject = `[발주 요청] ${item} 긴급 재고 발주 요청의 건`;
        } else if (/보고|진행/i.test(userContent)) {
          subject = '[업무 공유] 진행 현황 보고';
        } else if (/문의|답장|안내/i.test(userContent)) {
          subject = '[안내] 요청하신 내용에 대해 안내드립니다';
        } else if (userContent) {
          subject = `[공유] ${userContent.slice(0, 30)}`;
        }
      }
    }

    // 4. Extract Gmail 'body'
    let body = '';
    const codeBlockMatch = assistantContent.match(/```(?:text|markdown|email)?\s*\n([\s\S]*?)```/);
    if (codeBlockMatch && codeBlockMatch[1]) {
      body = codeBlockMatch[1].trim();
    } else {
      const dividerMatch = assistantContent.match(/---\s*\n([\s\S]*?)\n\s*---/);
      if (dividerMatch && dividerMatch[1]) {
        body = dividerMatch[1].trim();
      } else {
        const bodyHeaderMatch = assistantContent.match(/(?:본문|내용|메일\s*내용|메일\s*본문)\s*[:：]?\s*\n+([\s\S]+)/i);
        if (bodyHeaderMatch && bodyHeaderMatch[1]) {
          body = bodyHeaderMatch[1].trim();
        } else if (!isSystemOrchestrationMessage(assistantContent)) {
          // Remove leading intro line, meta headers (받는 사람, 제목) and closing question
          body = assistantContent
            .replace(/^[^\n\r]*?(?:초안을\s*작성했습니다|초안입니다|작성한\s*메일입니다)[.:]?\s*$/gim, '')
            .replace(/^(?:받는\s*사람|수신자?|To|제목|Subject)\s*[:：].*$/gim, '')
            .replace(/\n*(?:위 내용으로|이대로|위 메일).*?(?:발송할까요|보낼까요|확인해 주세요).*$/i, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        } else {
          // Synthesize from conversation and real query data
          const parts: string[] = ['안녕하세요, 담당자님.\n'];
          if (/발주|주문/i.test(userContent)) {
            parts.push('재고 현황 확인 결과, 긴급 발주가 필요하여 내용 공유드립니다.\n');
          } else if (userContent) {
            parts.push('요청하신 현황 관련하여 안내드립니다.\n');
          }

          if (dataSummary) {
            parts.push(dataSummary + '\n');
          }
          if (tableItems.length > 0) {
            parts.push('관련 품목 현황:\n' + tableItems.join('\n') + '\n');
          }
          parts.push('확인 부탁드리며, 빠른 조치 부탁드립니다.\n감사합니다.');
          body = parts.join('\n').trim();
        }
      }
    }

    return {
      draft: {
        tool: 'gmail',
        to,
        subject,
        body,
      },
      attachments,
    };
  }

  // Slack
  // 2. Extract Slack 'channel'
  let channel = '';
  const allInputRequests = [
    ...(assistant?.inputRequests ?? []),
    ...(assistant?.presentations?.flatMap(p => p.inputs ?? []) ?? []),
  ];

  for (const input of allInputRequests) {
    if (input.id.includes('slack') || input.id.includes('channel') || input.label.includes('채널')) {
      const firstOption = input.options?.[0];
      const optLabel = firstOption ? (firstOption.label || firstOption.value) : undefined;
      const option = optLabel || input.defaultValue;
      if (typeof option === 'string' && option.trim()) {
        channel = option.trim();
        break;
      }
    }
  }

  if (!channel) {
    const channelMatchAssistant = assistantContent.match(/(?:채널|Channel)\s*[:：]?\s*(#[a-zA-Z0-9_\-가-힣]+)/i)
      || assistantContent.match(/(#[a-zA-Z0-9_\-가-힣]+)/);
    if (channelMatchAssistant && channelMatchAssistant[1]) {
      channel = channelMatchAssistant[1];
    } else {
      const channelMatchUser = userContent.match(/(#[a-zA-Z0-9_\-가-힣]+)/);
      if (channelMatchUser && channelMatchUser[1]) {
        channel = channelMatchUser[1];
      }
    }
  }

  if (channel && !channel.startsWith('#') && !channel.startsWith('C0')) {
    channel = '#' + channel;
  }

  // 3. Extract Slack 'text'
  let text = '';
  const codeBlockMatch = assistantContent.match(/```(?:text|markdown)?\s*\n([\s\S]*?)```/);
  if (codeBlockMatch && codeBlockMatch[1]) {
    text = codeBlockMatch[1].trim();
  } else {
    const dividerMatch = assistantContent.match(/---\s*\n([\s\S]*?)\n\s*---/);
    if (dividerMatch && dividerMatch[1]) {
      text = dividerMatch[1].trim();
    } else {
      const textHeaderMatch = assistantContent.match(/(?:메시지|초안|내용)\s*[:：]?\s*\n+([\s\S]+)/i);
      if (textHeaderMatch && textHeaderMatch[1]) {
        text = textHeaderMatch[1].trim();
      } else if (!isSystemOrchestrationMessage(assistantContent)) {
        text = assistantContent
          .replace(/^[^\n\r]*?(?:초안입니다|메시지입니다|작성했습니다)[.:]?\s*$/gim, '')
          .replace(/^(?:채널|Channel|대상)\s*[:：].*$/gim, '')
          .replace(/\n*(?:위 내용으로|이대로|위 메시지).*?(?:게시할까요|올릴까요|확인해 주세요).*$/i, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      } else {
        // Synthesize from conversation and real query data
        let topic = '현황 요약';
        const topicMatch = userContent.match(/([가-힣\w\s]+(?:목록|현황|내용|보고|결과|재고))/);
        if (topicMatch) {
          topic = topicMatch[1].trim();
        }

        const parts: string[] = [`[${topic}]`];
        if (dataSummary) {
          parts.push(dataSummary);
        }
        if (tableItems.length > 0) {
          parts.push('주요 품목:\n' + tableItems.join('\n'));
        }
        if (parts.length === 1 && !dataSummary && tableItems.length === 0) {
          parts.push(userContent ? `${userContent} 관련 공유드립니다.` : '공유 요청 내용 전달드립니다.');
        }
        text = parts.join('\n\n');
      }
    }
  }

  return {
    draft: {
      tool: 'slack',
      channel,
      text,
    },
    attachments,
  };
}
