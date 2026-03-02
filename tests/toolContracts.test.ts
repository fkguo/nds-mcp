import { describe, it, expect } from 'vitest';
import { TOOL_SPECS, getTools } from '../src/tools/registry.js';

describe('NDS MCP tool contracts', () => {
  it('all tools have valid names', () => {
    for (const spec of TOOL_SPECS) {
      expect(spec.name).toMatch(/^nds_/);
    }
  });

  it('all tools have descriptions', () => {
    for (const spec of TOOL_SPECS) {
      expect(spec.description.length).toBeGreaterThan(10);
    }
  });

  it('getTools returns valid MCP tool definitions', () => {
    const tools = getTools('standard');
    const standardCount = TOOL_SPECS.filter(spec => spec.exposure === 'standard').length;
    expect(tools.length).toBe(standardCount);
    for (const tool of tools) {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('all tool names are unique', () => {
    const names = TOOL_SPECS.map(s => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('standard tools include nds_get_reaction_info', () => {
    const tools = getTools('standard');
    expect(tools.some(t => t.name === 'nds_get_reaction_info')).toBe(true);
  });

  it('expected tool count', () => {
    expect(TOOL_SPECS.length).toBe(24);
  });

  it('expected standard-mode tool count', () => {
    expect(getTools('standard').length).toBe(22);
  });
});
