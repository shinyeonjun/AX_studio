export function httpProbeErrorMessage(error: string | undefined): string {
  switch (error) {
    case 'connection_timeout':
      return '서버에 연결할 수 없습니다 (시간 초과).';
    case 'redirect_not_allowed':
      return 'Base URL이 다른 주소로 리다이렉트됩니다. 최종 URL을 직접 입력해 주세요.';
    case 'invalid_base_url':
      return 'Base URL 형식이 올바르지 않습니다.';
    case 'unsupported_protocol':
      return 'http 또는 https URL만 지원합니다.';
    case 'empty_base_url':
      return 'Base URL을 입력해 주세요.';
    case 'connection_failed':
      return 'Base URL에 연결할 수 없습니다. 서버 주소와 네트워크를 확인해 주세요.';
    default:
      return error
        ? `Base URL에 연결할 수 없습니다. (${error})`
        : 'Base URL에 연결할 수 없습니다.';
  }
}
