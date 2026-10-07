const MAX_WORK_NAME_CHARS = 40;

/**
 * A work's name from the request that made it, without the request's ask: "Gmail 새 메일이 오면
 * 요약해서 #ops로 알려주는 반복 업무를 만들어줘" -> "Gmail 새 메일이 오면 요약해서 #ops로 알려주는 업무".
 */
export function workNameFromRequest(request: string, fallback: string): string {
  let name = request.trim().replace(/[.!?。]+$/u, '').trim();
  // "...반복 업무를 만들어줘", "...작업 등록해 주세요": the ask, not the work.
  name = name.replace(/\s*(?:반복\s*)?(?:업무|작업|워크플로우|자동화)?\s*(?:을|를)?\s*(?:만들어|등록해|생성해|설정해|추가해)\s*(?:줘|주세요|줄래|주라)$/u, '').trim();
  // A clause that now ends in a modifier ("알려주는") names the work it modifies.
  if (/[는은던]$/u.test(name)) name = `${name} 업무`;
  if (!name) return fallback;
  return name.length > MAX_WORK_NAME_CHARS ? `${name.slice(0, MAX_WORK_NAME_CHARS - 1)}…` : name;
}
