import { getGuideImageSrc } from '../../lib/guide-images';

interface ConnectionGuideProps {
  steps: string;
  guideKey: string;
  placeholderName: string;
}

export function ConnectionGuide({ steps, guideKey, placeholderName }: ConnectionGuideProps) {
  const guideSrc = getGuideImageSrc(guideKey);
  return (
    <div className="connection-guide">
      <h4>연결 방법</h4>
      <div className="guide-placeholder">
        <p className="muted">{steps}</p>
        {guideSrc ? (
          <img src={guideSrc} alt={`${guideKey} 연결 가이드`} className="guide-image" />
        ) : (
          <div className="guide-image-slot">
            <span>{placeholderName}</span>
            <small>src/images/에 넣으면 여기에 표시됩니다</small>
          </div>
        )}
      </div>
    </div>
  );
}
