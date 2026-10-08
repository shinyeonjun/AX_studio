/** Common read-parameter names as people say them; the last path segment is what is matched. */
const KNOWN_VALUE_NAMES: Record<string, string> = {
  q: '검색어', query: '검색어', search: '검색어', keyword: '검색어', keywords: '검색어', term: '검색어',
  limit: '가져올 개수', count: '가져올 개수', size: '가져올 개수', per_page: '가져올 개수', perpage: '가져올 개수',
  page: '페이지', offset: '시작 위치', skip: '시작 위치',
  id: 'ID', channel: '채널', channelid: '채널', user: '사용자', userid: '사용자', email: '이메일',
  from: '시작 날짜', start: '시작 날짜', since: '시작 날짜', after: '시작 날짜', startdate: '시작 날짜',
  to: '끝 날짜', end: '끝 날짜', until: '끝 날짜', before: '끝 날짜', enddate: '끝 날짜', date: '날짜',
  category: '분류', status: '상태', name: '이름', table: '표', connectionid: '연결', path: '주소 경로',
};

/** A missing read value named for people: "검색어", or the raw name quoted when it is not a common one. */
export function readValueName(path: string): string {
  const last = path.slice(path.lastIndexOf('.') + 1);
  return KNOWN_VALUE_NAMES[last.toLowerCase().replace(/[-\s]/gu, '')] ?? `'${last}'`;
}

/** "검색어, 가져올 개수": each value once, in the order asked. */
export function readValueNames(paths: readonly string[]): string {
  return [...new Set(paths.map(readValueName))].join(', ');
}
