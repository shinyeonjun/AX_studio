import { DESIGN_TOOL_REGISTRY } from './registry.js';
import type { DesignToolId } from './types.js';

export function designToolNativeName(id: string): string {
  return id.replace(/\./g, '_');
}

export function designToolIdFromNativeName(name: string): DesignToolId {
  const match = DESIGN_TOOL_REGISTRY.find((entry) => designToolNativeName(entry.id) === name);
  if (!match) {
    throw Object.assign(new Error(`unknown_design_tool:${name}`), { code: 'unknown_design_tool' });
  }
  return match.id;
}

export function listNativeToolDescriptions(): Array<{
  name: string;
  description: string;
  args: string;
}> {
  return DESIGN_TOOL_REGISTRY.map((tool) => ({
    name: designToolNativeName(tool.id),
    description: tool.description,
    args: tool.args,
  }));
}
