import gmailIcon from '../../../../ui/images/connectors/gmail.png';
import { ConnectionGuide } from '../ConnectionGuide';
import { maskEmail } from '../../../../ui/lib/mask-email';
import {
  useGmailConnectionForm,
  type GmailConnectionFormProps,
} from './gmail-connection/use-gmail-connection-form';

/**
 * Each capability lists every scope that grants it. `gmail.compose` also permits sending,
 * so connections granted without the separate `gmail.send` scope still show sending as allowed.
 */
const GMAIL_CAPABILITY_LABELS = [
  { id: 'read', scopes: ['gmail.readonly', 'gmail.modify'], label: '메일 읽기 및 검색' },
  { id: 'compose', scopes: ['gmail.compose', 'gmail.modify'], label: '초안 작성' },
  { id: 'send', scopes: ['gmail.send', 'gmail.compose', 'gmail.modify'], label: '승인된 메일 발송' },
] as const;

const FULL_MAIL_SCOPE = 'https://mail.google.com/';

/** True when any granted OAuth scope (full URL or short name) is one of the accepted scopes. */
function hasAnyGmailScope(granted: string[] | undefined, accepted: readonly string[]): boolean {
  return granted?.some((scope) => {
    if (scope === FULL_MAIL_SCOPE) return true;
    const short = scope.replace(/^https:\/\/www\.googleapis\.com\/auth\//u, '');
    return accepted.includes(short);
  }) ?? false;
}

export function GmailConnectionForm({ state, embedded = false, onConnect, onDisconnect }: GmailConnectionFormProps) {
  const { busy, message, messageIsError, handleConnect, handleDisconnect } = useGmailConnectionForm({ onConnect, onDisconnect });
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
                {GMAIL_CAPABILITY_LABELS.map(({ id, scopes: accepted, label }) => (
                  <li key={id}>
                    {hasAnyGmailScope(scopes, accepted) ? '✓' : '·'} {label}
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
              <p className="muted" role="note" style={{ marginBottom: 12 }}>
                Gmail 연결 기능이 이 설치본에 준비되지 않았어요. 관리자에게 문의해 주세요.
              </p>
            )}
            {/* Developer builds only: where the OAuth client id is read from. */}
            {!oauthReady && import.meta.env.DEV && (
              <p className="muted" style={{ marginBottom: 12 }}>
                개발용: Gmail OAuth Client ID가 없습니다.{' '}
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
          <p className={`connection-form-message ${messageIsError ? 'error' : ''}`} role="status" style={{ marginTop: 12 }}>
            {message}
          </p>
        )}
      </div>

      {!embedded && (
        <ConnectionGuide
          guideKey="gmail"
          steps="Gmail 연결하기 → 브라우저에서 Google 로그인 → 권한 허용 → AX Studio로 돌아오기"
        />
      )}
    </div>
  );
}
