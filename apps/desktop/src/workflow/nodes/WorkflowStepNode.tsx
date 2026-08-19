import { Handle, Position, type NodeProps } from '@xyflow/react';
import { WORKFLOW_KIND_BADGE, type WorkflowVisualNodeData } from '../types.js';

const KIND_SYMBOL: Record<WorkflowVisualNodeData['kind'], string> = {
  trigger: '⚡',
  action: '▸',
  ai_decision: '✦',
  if: '◇',
  human_approval: '◆',
  join: '',
  placeholder: '…',
  system: '⚙',
};

const CHANGE_LABEL: Record<NonNullable<WorkflowVisualNodeData['change']>, string> = {
  added: '추가',
  modified: '수정',
  unchanged: '',
};

function nodeCaption(visual: WorkflowVisualNodeData): string {
  return visual.card?.summary ?? visual.label;
}

function nodeCaptionSub(visual: WorkflowVisualNodeData): string | undefined {
  return visual.card?.captionSub;
}

function kindBadge(visual: WorkflowVisualNodeData): string | undefined {
  return WORKFLOW_KIND_BADGE[visual.kind];
}

function NodeIcon({ visual }: { visual: WorkflowVisualNodeData }) {
  if (visual.iconSrc) {
    return <img src={visual.iconSrc} alt="" className="wf-node-img" draggable={false} />;
  }
  return (
    <span className="wf-node-symbol" aria-hidden="true">
      {KIND_SYMBOL[visual.kind] ?? '•'}
    </span>
  );
}

function CircleNode({
  visual,
  selected,
  enterDelay,
}: {
  visual: WorkflowVisualNodeData;
  selected: boolean;
  enterDelay: string;
}) {
  const caption = nodeCaption(visual);
  const captionSub = nodeCaptionSub(visual);
  const badge = kindBadge(visual);
  const changeLabel = visual.change && visual.change !== 'unchanged' ? CHANGE_LABEL[visual.change] : '';
  const className = [
    'wf-node',
    'wf-node-compact',
    'wf-node-enter',
    `wf-node-${visual.kind}`,
    visual.incomplete ? 'wf-node-incomplete' : 'wf-node-complete',
    visual.change === 'added' ? 'wf-node-change-added' : '',
    visual.change === 'modified' ? 'wf-node-change-modified' : '',
    selected ? 'wf-node-selected' : '',
    captionSub ? 'wf-node-has-sub' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={className}
      style={{ animationDelay: enterDelay }}
      title={visual.tooltip ?? (captionSub ? `${caption}\n${captionSub}` : caption)}
    >
      <Handle type="target" position={Position.Top} className="wf-handle" />
      {changeLabel && (
        <span className={`wf-node-change-badge wf-node-change-${visual.change}`}>{changeLabel}</span>
      )}
      <div className="wf-node-circle-wrap">
        {badge && (
          <span className={`wf-node-kind-badge wf-node-kind-badge-${visual.kind}`}>{badge}</span>
        )}
        <div className="wf-node-circle">
          <NodeIcon visual={visual} />
        </div>
      </div>
      <div className="wf-node-caption">{caption}</div>
      {captionSub ? <div className="wf-node-caption-sub">{captionSub}</div> : null}
      <Handle type="source" position={Position.Bottom} className="wf-handle" />
    </div>
  );
}

export function WorkflowStepNode({ data, selected }: NodeProps) {
  const visual = data as WorkflowVisualNodeData;
  const isJoin = visual.kind === 'join';
  const enterDelay = visual.enterIndex != null ? `${Math.min(visual.enterIndex, 8) * 55}ms` : '0ms';

  if (isJoin) {
    return (
      <div className={`wf-node wf-node-join ${selected ? 'wf-node-selected' : ''}`}>
        <Handle type="target" position={Position.Top} className="wf-handle" />
        <div className="wf-node-join-dot" />
        <Handle type="source" position={Position.Bottom} className="wf-handle" />
      </div>
    );
  }

  return <CircleNode visual={visual} selected={Boolean(selected)} enterDelay={enterDelay} />;
}
