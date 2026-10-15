import { useState } from 'react';
import { MODE_LABELS, type DecisionMode } from './contracts';

interface ShareDonutProps {
  title: string;
  /** Each mode's part of the whole; a missing mode is left out. */
  values: Partial<Record<DecisionMode, number>>;
  format: (value: number) => string;
}

const MODES: DecisionMode[] = ['jev', 'llm'];
const SIZE = 148;
const STROKE = 22;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** The surface gap between the two segments, in px along the ring. */
const GAP = 2;

/** One part-to-whole ring: how the whole splits between Jev and LLM, with the hovered part in the middle. */
export function ShareDonut({ title, values, format }: ShareDonutProps) {
  const [hovered, setHovered] = useState<DecisionMode | null>(null);
  const parts = MODES.filter((mode) => (values[mode] ?? 0) > 0).map((mode) => ({ mode, value: values[mode]! }));
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const share = (value: number) => (total ? value / total : 0);
  const focus = parts.find((part) => part.mode === hovered);

  let offset = 0;
  const segments = parts.map((part) => {
    const length = share(part.value) * CIRCUMFERENCE;
    const visible = parts.length > 1 ? Math.max(length - GAP, 0) : length;
    const segment = { ...part, dash: `${visible} ${CIRCUMFERENCE - visible}`, offset: -offset };
    offset += length;
    return segment;
  });

  return (
    <figure className="usage-donut">
      <figcaption className="usage-donut-title">{title}</figcaption>
      <div className="usage-donut-chart">
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`${title}: ${parts.map((part) => `${MODE_LABELS[part.mode]} ${Math.round(share(part.value) * 100)}%`).join(', ')}`}>
          <circle className="usage-donut-track" cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} strokeWidth={STROKE} fill="none" />
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            {segments.map((segment) => (
              <circle
                key={segment.mode}
                className={`usage-donut-segment usage-donut-segment--${segment.mode}${hovered && hovered !== segment.mode ? ' dimmed' : ''}`}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                strokeWidth={STROKE}
                strokeDasharray={segment.dash}
                strokeDashoffset={segment.offset}
                onMouseEnter={() => setHovered(segment.mode)}
                onMouseLeave={() => setHovered(null)}
              />
            ))}
          </g>
        </svg>
        <div className="usage-donut-center" aria-hidden>
          {focus ? (
            <>
              <strong>{Math.round(share(focus.value) * 100)}%</strong>
              <span>{MODE_LABELS[focus.mode]} · {format(focus.value)}</span>
            </>
          ) : (
            <>
              <strong>{format(total)}</strong>
              <span>합계</span>
            </>
          )}
        </div>
      </div>
      <ul className="usage-donut-legend">
        {parts.map((part) => (
          <li key={part.mode} onMouseEnter={() => setHovered(part.mode)} onMouseLeave={() => setHovered(null)}>
            <span className={`usage-swatch usage-swatch--${part.mode}`} aria-hidden />
            <span className="usage-legend-label">{MODE_LABELS[part.mode]}</span>
            <span className="usage-legend-value">{format(part.value)}</span>
            <span className="usage-legend-share">{Math.round(share(part.value) * 100)}%</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
