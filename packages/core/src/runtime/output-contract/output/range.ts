export function rangeText(min: number, max: number, ratio: number): string {
  return String(min) + '..' + String(max) + ' ± ' + String(Math.round(ratio * 100)) + '%';
}

export function rangeContains(value: number, min: number, max: number, ratio: number): boolean {
  const padding = Math.max(Math.abs(min), Math.abs(max), 1) * ratio;
  return value >= min - padding && value <= max + padding;
}
