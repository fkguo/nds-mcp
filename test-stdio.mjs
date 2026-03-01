#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

function main() {
  const req = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
  const proc = spawnSync('npx', ['-y', 'nds-mcp'], {
    input: JSON.stringify(req),
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (proc.error) {
    throw proc.error;
  }
  if (proc.status !== 0) {
    throw new Error(`process exit=${proc.status}, stderr=${(proc.stderr || '').slice(0, 300)}`);
  }

  const stdout = (proc.stdout || '').trim();
  const stderr = proc.stderr || '';
  if (stdout.length === 0) {
    throw new Error('stdout is empty');
  }

  const lines = stdout.split('\n').filter((line) => line.trim().length > 0);
  for (const line of lines) {
    const parsed = JSON.parse(line);
    if (!parsed || parsed.jsonrpc !== '2.0') {
      throw new Error(`stdout contains non JSON-RPC line: ${line.slice(0, 200)}`);
    }
  }

  const last = JSON.parse(lines[lines.length - 1]);
  if (!last.result || !Array.isArray(last.result.tools)) {
    throw new Error('last stdout JSON-RPC line is not tools/list result');
  }
  if (!stderr.includes('[nds-mcp]')) {
    throw new Error('stderr does not contain [nds-mcp] logs');
  }

  console.error(`[test-stdio] OK: stdout JSON-RPC lines=${lines.length}, tools=${last.result.tools.length}`);
  console.error('[test-stdio] OK: stderr contains [nds-mcp] logs');
}

try {
  main();
} catch (err) {
  console.error('[test-stdio] FAIL:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
