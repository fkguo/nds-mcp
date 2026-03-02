import { describe, expect, it, vi } from 'vitest';
import {
  compareSemver,
  checkNpmUpdate,
  runNpmSelfUpdate,
} from '../src/selfUpdate.js';

describe('selfUpdate', () => {
  it('compares semver values correctly', () => {
    expect(compareSemver('0.2.0', '0.2.0')).toBe(0);
    expect(compareSemver('0.2.0', '0.3.0')).toBe(-1);
    expect(compareSemver('1.0.0', '0.9.9')).toBe(1);
  });

  it('reports update availability from npm metadata', async () => {
    const fakeFetchJson = vi.fn(async () => ({ 'dist-tags': { latest: '0.3.1' } }));
    const result = await checkNpmUpdate({
      currentVersion: '0.2.0',
      fetchJson: fakeFetchJson,
      packageName: 'nds-mcp',
    });
    expect(result.package_name).toBe('nds-mcp');
    expect(result.current_version).toBe('0.2.0');
    expect(result.latest_version).toBe('0.3.1');
    expect(result.update_available).toBe(true);
  });

  it('executes npm install -g only when confirm=true', () => {
    const fakeExec = vi.fn(() => 'ok');
    expect(() => runNpmSelfUpdate({ confirm: false, execNpm: fakeExec })).toThrow(/confirm=true/);
    const result = runNpmSelfUpdate({ confirm: true, execNpm: fakeExec, target: 'latest' });
    expect(fakeExec).toHaveBeenCalledTimes(1);
    expect(result.command).toContain('npm install -g nds-mcp@latest');
  });
});
