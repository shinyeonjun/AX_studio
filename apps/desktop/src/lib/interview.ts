export function getInterviewStep(interview: { done?: boolean } | null, saved: boolean): number {
  if (saved) return 4;
  if (!interview) return 1;
  if (!interview.done) return 2;
  return 3;
}
