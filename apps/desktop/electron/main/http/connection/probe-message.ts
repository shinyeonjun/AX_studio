export function httpProbeErrorMessage(error: string | undefined): string {
  switch (error) {
    case 'connection_timeout':
      return '서버가 응답하지 않아요. 서버 주소와 인터넷 연결을 확인해 주세요.';
    case 'redirect_not_allowed':
      return '주소가 다른 곳으로 넘어가요. 최종 주소를 입력해 주세요.';
    case 'private_destination_not_allowed':
      return '내 컴퓨터(localhost)나 사내망 주소는 보안상 연결할 수 없어요. 인터넷에서 접속할 수 있는 주소를 입력해 주세요.';
    case 'url_credentials_not_allowed':
      return '주소에 아이디·비밀번호를 넣을 수 없어요. 주소에서 빼고 아래 인증 방식에 입력해 주세요.';
    case 'invalid_base_url':
      return '서버 주소 형식이 올바르지 않아요. 예: https://api.example.com';
    case 'unsupported_protocol':
      return '서버 주소는 http:// 또는 https:// 로 시작해야 해요.';
    case 'empty_base_url':
      return '서버 주소를 입력해 주세요.';
    case 'connection_failed':
      return '서버에 연결할 수 없어요. 인터넷 연결과 서버 주소를 확인해 주세요.';
    default:
      return error
        ? `서버에 연결할 수 없어요. 인터넷 연결과 서버 주소를 확인해 주세요. (${error})`
        : '서버에 연결할 수 없어요. 인터넷 연결과 서버 주소를 확인해 주세요.';
  }
}

/** The server answered 401: with credentials they were refused, without them some are needed. */
export function httpAuthRejectedMessage(sentCredentials: boolean): string {
  return sentCredentials
    ? '서버가 입력한 인증 정보를 받아들이지 않았어요. 토큰이나 아이디·비밀번호를 다시 확인해 주세요.'
    : '이 서버는 인증이 필요해요. 아래에서 인증 방식을 고르고 토큰이나 키를 입력해 주세요.';
}
