import { getCapability } from '@ax-studio/core/catalog-data';
import type { AppState } from '../../../../types/app-state';

type Approval = AppState['approvals'][number];

/** Values that must never be put on screen, whatever the capability calls them. */
const SECRET_PARAM = /password|secret|token|api[_-]?key|credential/iu;

export interface ApprovalPreviewItem {
  title: string;
  fields: Array<{ label: string; value: string; long: boolean }>;
}

function shown(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() ? value : undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

/**
 * What an approval will actually send, from the values frozen when the run stopped for approval
 * (the same values the approval's hash covers): "Slack 메시지 · 채널 #ax테스트 · 메시지 …".
 */
export function approvalPreview(approval: Pick<Approval, 'payload'>): ApprovalPreviewItem[] {
  const snapshots = approval.payload?.actionSnapshots;
  if (!Array.isArray(snapshots)) return [];
  return snapshots.flatMap((snapshot) => {
    if (!snapshot?.params || typeof snapshot.params !== 'object') return [];
    const capability = typeof snapshot.actionRef === 'string' ? getCapability(snapshot.actionRef.split('@')[0]!) : undefined;
    const params = snapshot.params;
    const declared = capability?.params ?? [];
    const names = [...declared.map((param) => param.name), ...Object.keys(params).filter((name) => !declared.some((param) => param.name === name))];
    const fields = names.flatMap((name) => {
      if (SECRET_PARAM.test(name)) return [];
      const value = shown(params[name]);
      if (value === undefined) return [];
      // An undeclared param name is an internal key; it is shown only as a generic label.
      const label = declared.find((param) => param.name === name)?.label ?? '기타 값';
      return [{ label, value, long: value.length > 80 || value.includes('\n') }];
    });
    return fields.length > 0 ? [{ title: capability?.label ?? '보낼 내용', fields }] : [];
  });
}

/** The approver sees exactly what goes out before deciding. */
export function ApprovalSendPreview({ approval }: { approval: Pick<Approval, 'payload'> }) {
  const items = approvalPreview(approval);
  if (items.length === 0) return null;
  return (
    <div className="approval-preview" aria-label="보낼 내용">
      {items.map((item, index) => (
        <section key={index} className="approval-preview-item">
          <h4>{item.title}</h4>
          <dl>
            {item.fields.map((field, fieldIndex) => (
              <div key={fieldIndex} className={field.long ? 'approval-preview-field approval-preview-field--long' : 'approval-preview-field'}>
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
