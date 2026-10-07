import type { SourceListingConnection } from '../../../connectors/types.js';
import { parseLocalFolderConnectionConfig } from '../../../platform/local-folder-config.js';
import { addIndexedOperation, type IndexedReadOperation } from './indexed-operation.js';
import { explicitLimit, explicitParameterValue, limitParameterHint, naturalLimitChoices, text } from './request-values.js';

function explicitSheetPath(message: string): string | undefined {
  const labeled = /(?:^|[\s,;])(?:path|file|파일(?:\s*경로)?)\s*[:=]\s*(?:"([^"]{1,500})"|“([^”]{1,500})”|'([^']{1,500})'|([^\s,;]{1,500}))/iu.exec(message);
  const labeledValue = labeled?.slice(1).find((value): value is string => typeof value === 'string');
  if (labeledValue) return /\.(?:csv|xlsx?)$/iu.test(labeledValue) ? labeledValue : undefined;

  const quoted = [...message.matchAll(/["“'`]([^"'“”`\r\n]{1,500}\.(?:csv|xlsx?))["”'`]/giu)]
    .map((match) => match[1]);
  if (quoted.length > 0) {
    const unique = [...new Set(quoted)];
    return unique.length === 1 ? unique[0] : undefined;
  }

  const bare = [...message.matchAll(/(?:^|[\s])([^\s<>|?*;,"'`]{1,500}\.(?:csv|xlsx?))(?=$|[\s.,!?]|(?:에서|으로|부터|까지|을|를|은|는|의|에|로))/giu)]
    .map((match) => match[1]);
  const unique = [...new Set(bare)];
  return unique.length === 1 ? unique[0] : undefined;
}

function explicitSheetName(message: string): string | undefined {
  const match = /(?:^|[\s,;])(?:sheet(?:Name)?|시트)\s*[:=]\s*(?:"([^"]{1,200})"|“([^”]{1,200})”|'([^']{1,200})'|([^\s,;]{1,200}))/iu.exec(message);
  return match?.slice(1).find((value): value is string => typeof value === 'string')?.trim() || undefined;
}

export function addLocalFolderOperations(
  operations: IndexedReadOperation[],
  connection: SourceListingConnection,
): void {
  const config = parseLocalFolderConnectionConfig(connection.config);
  for (const folder of config?.folders ?? []) {
    const sourceLabel = text(folder.label, 160) ?? '로컬 폴더';
    addIndexedOperation(operations, {
      capabilityId: 'local_folder.list',
      connector: 'local_folder',
      sourceLabel,
      label: `${sourceLabel}: 파일 목록`.slice(0, 160),
      description: '연결 폴더의 파일 목록 조회',
    }, (userMessage) => {
      const offset = explicitParameterValue(userMessage, 'offset');
      const parsedOffset = offset && /^\d+$/u.test(offset) ? Number(offset) : undefined;
      const limit = explicitLimit(userMessage);
      // A count stated in words is left for Jev to choose; with none, list a default page.
      const limitChoices = naturalLimitChoices('limit', 'integer', userMessage);
      return {
        params: {
          folderId: folder.id,
          ...(limit !== undefined ? { limit } : limitChoices ? {} : { limit: 20 }),
          ...(parsedOffset !== undefined && Number.isSafeInteger(parsedOffset) ? { offset: parsedOffset } : {}),
        },
        parameterHints: [limitParameterHint('limit', userMessage)],
      };
    });

    addIndexedOperation(operations, {
      capabilityId: 'local_sheet.read',
      connector: 'local_sheet',
      sourceLabel,
      label: `${sourceLabel}: 스프레드시트 읽기`.slice(0, 160),
      description: '연결 폴더에서 지정한 CSV/XLSX 파일의 표를 읽기',
    }, (userMessage) => {
      const path = explicitSheetPath(userMessage);
      const sheet = explicitSheetName(userMessage);
      return {
        params: {
          folderId: folder.id,
          ...(path ? { path } : {}),
          ...(sheet ? { sheet } : {}),
        },
        parameterHints: [
          { path: 'path', type: 'string', required: true },
          { path: 'sheet', type: 'string', required: false },
        ],
        missingParameterPaths: path ? [] : ['path'],
      };
    });
  }
}
