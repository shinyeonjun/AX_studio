import { CONNECTOR_UI_CATALOG, type ConnectorUiId } from '../../../ui/constants/connectors';
import { getGuideImageSrc } from '../../../ui/lib/guide-images';

interface ConnectionGuideProps {
  title?: string;
  steps: string | string[];
  guideKey?: string;
  /** Long setup steps start folded so the form itself stays short. */
  collapsible?: boolean;
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

export function ConnectionGuide({ title, steps, guideKey, collapsible = false }: ConnectionGuideProps) {
  const guideSrc = guideKey ? getGuideImageSrc(guideKey) : undefined;
  // The key is an internal id ("local_folder"); the alt text names the service as the app does.
  const guideAlt = `${(guideKey && CONNECTOR_UI_CATALOG[guideKey as ConnectorUiId]?.title) || '서비스'} 연결 가이드`;
  if (collapsible) {
    return (
      <details className="connection-guide connection-form-details">
        <summary>{title ?? '연결 방법'}</summary>
        <div className="guide-placeholder">
          {renderSteps(steps)}
          {guideSrc ? (
            <img src={guideSrc} alt={guideAlt} className="guide-image" />
          ) : null}
        </div>
      </details>
    );
  }
  return (
    <div className="connection-guide">
      <h4>{title ?? '연결 방법'}</h4>
      <div className="guide-placeholder">
        {renderSteps(steps)}
        {guideSrc ? (
          <img src={guideSrc} alt={guideAlt} className="guide-image" />
        ) : null}
      </div>
    </div>
  );
}
