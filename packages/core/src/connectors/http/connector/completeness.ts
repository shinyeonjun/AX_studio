/** A Link relation is protocol metadata, not a guess about JSON response fields. */
export function hasNextHttpPage(link: string | undefined): boolean {
  if (!link) return false;
  // Keep commas/semicolons inside quoted values and link targets intact.
  const parts = link.match(/<[^>]*>|"(?:\\.|[^"\\])*"|[^<";,]+|[;,]/g) ?? [];
  let parameter = '';
  const isNext = () => {
    const match = /^\s*rel\s*=\s*(?:"([^"]*)"|([^\s]+))\s*$/i.exec(parameter);
    return (match?.[1] ?? match?.[2] ?? '').toLowerCase().split(/\s+/).includes('next');
  };
  for (const part of parts) {
    if (part === ';' || part === ',') {
      if (isNext()) return true;
      parameter = '';
    } else {
      parameter += part;
    }
  }
  return isNext();
}
