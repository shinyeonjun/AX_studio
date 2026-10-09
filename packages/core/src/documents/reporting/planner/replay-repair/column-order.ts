import type { ReplayRepairInput, ReplayRepairResult } from './shared.js';

/**
 * Two table columns bound the wrong way round (입고 shown under 출고): swap the result columns of
 * two template columns whose cells are wrong. Only bindings move; the plan is unchanged, and the
 * swap is kept only when the replay gets strictly better.
 */
export function applyColumnOrderVariants(input: ReplayRepairInput, current: ReplayRepairResult): ReplayRepairInput[] {
  const bad = new Set(current.mismatches.map((mismatch) => mismatch.slotId));
  const groups = new Map(input.pair.tableGroups.map((group) => [group.id, group]));
  const variants: ReplayRepairInput[] = [];
  input.layout.tableBindings.forEach((binding, bindingIndex) => {
    const group = groups.get(binding.groupId);
    if (!group) return;
    const wrong = binding.columns.filter((column) => group.rows.some((row) => bad.has(row.cells[column.columnIndex]?.id ?? '')));
    for (let left = 0; left < wrong.length; left += 1) {
      for (let right = left + 1; right < wrong.length; right += 1) {
        const a = wrong[left]!;
        const b = wrong[right]!;
        const columns = binding.columns.map((column) => (
          column.columnIndex === a.columnIndex ? { ...column, columnId: b.columnId }
            : column.columnIndex === b.columnIndex ? { ...column, columnId: a.columnId } : column));
        variants.push({ ...input, layout: { ...input.layout, tableBindings: input.layout.tableBindings
          .map((item, index) => (index === bindingIndex ? { ...item, columns } : item)) } });
      }
    }
  });
  return variants;
}
