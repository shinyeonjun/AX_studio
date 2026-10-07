import type { AppState } from '../../../../types/app-state';

type Approval = AppState['approvals'][number];

const MAX_LISTED_FIELDS = 3;

export interface ApprovalTruncatedField {
  path: string;
  originalLength: number;
}

/** Fields the backend shortened in the approval display snapshot (the params hash still covers the full value). */
export function approvalTruncatedFields(approval: Pick<Approval, 'payload'>): ApprovalTruncatedField[] {
  const snapshots = approval.payload?.actionSnapshots;
  if (!Array.isArray(snapshots)) return [];
  const fields: ApprovalTruncatedField[] = [];
  let truncatedWithoutDetail = false;
  for (const snapshot of snapshots) {
    if (!snapshot || snapshot.truncated !== true) continue;
    const listed = Array.isArray(snapshot.truncatedFields) ? snapshot.truncatedFields : [];
    if (listed.length === 0) truncatedWithoutDetail = true;
    for (const field of listed) {
      if (field && typeof field.path === 'string' && typeof field.originalLength === 'number') fields.push(field);
    }
  }
  // A truncated snapshot without field details must still produce a note.
  if (fields.length === 0 && truncatedWithoutDetail) return [{ path: '', originalLength: 0 }];
  return fields;
}

/** The last segment of a value path ("params.body") as a person would name it. */
const FIELD_NAMES: Record<string, string> = {
  body: '본문',
  html: '본문',
  text: '내용',
  content: '내용',
  message: '메시지',
  subject: '제목',
  title: '제목',
  to: '받는 사람',
  cc: '참조',
  bcc: '숨은 참조',
  channel: '채널',
  description: '설명',
};

function fieldName(path: string): string {
  if (!path) return '(전체 값)';
  const last = path.split('.').at(-1)?.replace(/\[\d+\]$/u, '') ?? '';
  return Object.hasOwn(FIELD_NAMES, last) ? FIELD_NAMES[last]! : '내용';
}

function fieldLabel(field: ApprovalTruncatedField): string {
  const name = fieldName(field.path);
  return field.originalLength > 0 ? `${name} 원래 길이 ${field.originalLength.toLocaleString('ko-KR')}` : name;
}

/**
 * The renderer only receives the shortened display copy, so there is no "전체 보기";
 * the note makes sure the reviewer never mistakes a cut value for the whole payload.
 */
export function ApprovalTruncationNote({ approval }: { approval: Pick<Approval, 'payload'> }) {
  const all = approvalTruncatedFields(approval);
  if (all.length === 0) return null;
  const fields = all.filter((field) => field.path || field.originalLength > 0);
  const listed = fields.slice(0, MAX_LISTED_FIELDS).map(fieldLabel);
  const more = fields.length - listed.length;
  return (
    <p className="approval-truncation-note" role="note">
      <strong>일부만 표시됨:</strong> 승인 화면에는 긴 값이 잘려 표시됩니다. 실제 실행에는 원래 값 전체가 사용됩니다.
      {listed.length > 0 && ` (${listed.join(', ')}${more > 0 ? ` 외 ${more}개` : ''})`}
    </p>
  );
}
