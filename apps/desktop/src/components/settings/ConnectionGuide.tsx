import { getGuideImageSrc } from '../../lib/guide-images';

interface ConnectionGuideProps {
  title?: string;
  steps: string | string[];
  guideKey?: string;
  /** @deprecated Guide images render only when packaged assets exist. */
  placeholderName?: string;
}

function renderSteps(steps: string | string[]) {
  if (typeof steps === 'string') {
    return <p className="muted">{steps}</p>;
  }
  return (
    <ol className="connection-guide-steps">
      {steps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
  );
}

export function ConnectionGuide({ title, steps, guideKey }: ConnectionGuideProps) {
  const guideSrc = guideKey ? getGuideImageSrc(guideKey) : undefined;
  return (
    <div className="connection-guide">
      <h4>{title ?? '연결 방법'}</h4>
      <div className="guide-placeholder">
        {renderSteps(steps)}
        {guideSrc ? (
          <img src={guideSrc} alt={`${guideKey} 연결 가이드`} className="guide-image" />
        ) : null}
      </div>
    </div>
  );
}
