export interface DesignToolListEntry {
  id: string;
  description: string;
  args: string;
}

export function formatDesignToolsList(entries: readonly DesignToolListEntry[]) {
  return entries.map(({ id, description, args }) => ({
    id,
    description,
    args,
  }));
}
