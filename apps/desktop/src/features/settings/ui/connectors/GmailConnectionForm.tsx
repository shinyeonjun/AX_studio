import gmailIcon from '../../../../ui/images/connectors/gmail.png';
import { ConnectionGuide } from '../ConnectionGuide';
import { maskEmail } from '../../../../ui/lib/mask-email';
import {
  useGmailConnectionForm,
  type GmailConnectionFormProps,
} from './gmail-connection/use-gmail-connection-form';

const GMAIL_CAPABILITY_LABELS = [
  { scope: 'gmail.readonly', label: '메일 읽기 및 검색' },
  { scope: 'gmail.compose', label: '초안 작성' },
  { scope: 'gmail.send', label: '승인된 메일 발송' },
] as const;

function hasScope(scopes: string[] | undefined, token: string): boolean {
  return scopes?.some((scope) => scope.includes(token)) ?? false;
}

export function GmailConnectionForm({ state, embedded = false, onConnect, onDisconnect, onRefresh }: GmailConnectionFormProps) {
  const { busy, message, handleConnect, handleDisconnect, configureClient } = useGmailConnectionForm({ onConnect, onDisconnect, onRefresh });
  const connected = state?.connections?.find((c) => c.connector === 'gmail')?.connected;
  const oauthReady = state?.gmailOAuthConfigured ?? false;
  const email = state?.gmailEmail;
  const scopes = state?.gmailScopes;

  return (
    <div className={embedded ? 'settings-panel' : 'connection-detail'}>
      <div className={`settings-section connection-form ${embedded ? 'connection-form-compact' : ''}`}>
        <div className="connection-form-header">
          <img src={gmailIcon} alt="" className="connection-form-icon" />
          <div>
            <h3>Gmail</h3>
            <p className="muted">
              {connected
                ? '고객 메일을 읽고 검색하며 초안을 만들고 승인 후 발송할 수 있어요.'
                : '메일 읽기 · 검색 · 초안 · 발송'}
            </p>
          </div>
          {connected && <span className="connection-badge connected">연결됨 ✓</span>}
        </div>

        {connected ? (
          <>
            {email && (
              <p className="connection-account" title={email}>
                연결 계정: {maskEmail(email)}
              </p>
            )}

            <div className="connection-capabilities" style={{ marginTop: 16 }}>
              <div className="provider-option-title" style={{ marginBottom: 8 }}>
                허용된 기능
              </div>
              <ul className="connection-capability-list">
                {GMAIL_CAPABILITY_LABELS.map(({ scope, label }) => (
                  <li key={scope}>
                    {hasScope(scopes, scope) ? '✓' : '·'} {label}
                  </li>
                ))}
              </ul>
            </div>

            <div className="connection-form-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleDisconnect}
                disabled={busy}
              >
                {busy ? '처리 중...' : '연결 해제'}
              </button>
            </div>
          </>
        ) : (
          <>
            {!oauthReady && (
              <p role="status" className="muted">
                {state?.gmailOAuthError ?? '이 배포본에는 Google 로그인 설정이 포함되지 않았습니다. 본인의 Google 데스크톱 앱 OAuth 클라이언트 JSON을 가져온 뒤 연결할 수 있습니다.'}
              </p>
            )}
            <div className="connection-form-footer gmail-client-actions">
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void configureClient()}>
                OAuth 클라이언트 JSON 가져오기
              </button>
              {(state?.gmailOAuthCustom || state?.gmailOAuthError) && (
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void configureClient(true)}>
                  가져온 OAuth 설정 제거
                </button>
              )}
            </div>
            <p className="muted">Google Cloud에서 Gmail API와 OAuth 동의 화면을 설정하고, 데스크톱 앱 유형의 클라이언트 JSON을 내려받으세요. 설정은 이 PC의 OS 암호화 저장소에 보관됩니다.</p>
            {!oauthReady && import.meta.env.DEV && (
              <p className="muted" style={{ marginBottom: 12 }}>
                Gmail OAuth Client ID가 없습니다.{' '}
                {state?.envFilePath ? (
                  <>
                    <code>{state.envFilePath}</code>에{' '}
                    <code>GOOGLE_OAUTH_CLIENT_ID=...</code>를 넣고 앱을 다시 시작하세요.
                  </>
                ) : (
                  <>
                    프로젝트 루트 <code>.env</code>에 <code>GOOGLE_OAUTH_CLIENT_ID</code>를 넣고 앱을
                    다시 시작하세요.
                  </>
                )}
              </p>
            )}

            <div className="connection-form-footer">
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConnect}
                disabled={busy || !oauthReady}
              >
                {busy ? '연결 중...' : 'Gmail 연결하기'}
              </button>
            </div>
          </>
        )}

        {message && (
          <p className="muted" style={{ marginTop: 12 }}>
            {message}
          </p>
        )}
      </div>

      {!embedded && (
        <ConnectionGuide
          guideKey="gmail"
          placeholderName="gmail-guide.png"
          steps="Gmail 연결하기 → 브라우저에서 Google 로그인 → 권한 허용 → AX Studio로 돌아오기"
        />
      )}
    </div>
  );
}
