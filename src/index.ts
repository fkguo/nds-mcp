#!/usr/bin/env node

import './utils/stdioHygiene.js';

import { fileURLToPath } from 'url';
import { realpathSync } from 'fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { getTools, handleToolCall, type ToolExposureMode } from './tools/index.js';
import { ensureNdsDb } from './db/ensureDb.js';
import { runIngestCli } from './ingest/cli.js';

const TOOL_MODE: ToolExposureMode = process.env.NDS_TOOL_MODE === 'full' ? 'full' : 'standard';

const server = new Server(
  {
    name: 'nds-mcp',
    version: '0.2.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: getTools(TOOL_MODE) };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  return handleToolCall(request.params.name, request.params.arguments ?? {}, TOOL_MODE);
});

interface SimpleJsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function simpleJsonRpcResult(
  id: string | number | null | undefined,
  result: unknown,
): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    result,
  };
}

function simpleJsonRpcError(
  id: string | number | null | undefined,
  code: number,
  message: string,
): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message },
  };
}

async function handleSimpleJsonRpcRequest(request: SimpleJsonRpcRequest): Promise<Record<string, unknown>> {
  if (request.method === 'tools/list') {
    return simpleJsonRpcResult(request.id, { tools: getTools(TOOL_MODE) });
  }

  if (request.method === 'tools/call') {
    const params = request.params ?? {};
    const name = typeof params.name === 'string' ? params.name : '';
    const args = (
      typeof params.arguments === 'object' &&
      params.arguments !== null &&
      !Array.isArray(params.arguments)
    )
      ? params.arguments as Record<string, unknown>
      : {};
    if (name.length === 0) {
      return simpleJsonRpcError(request.id, -32602, 'Invalid params: tools/call requires name');
    }
    const response = await handleToolCall(name, args, TOOL_MODE);
    return simpleJsonRpcResult(request.id, response);
  }

  return simpleJsonRpcError(request.id, -32601, `Method not found: ${request.method ?? '(missing)'}`);
}

async function maybeServeSimpleJsonRpcOnce(): Promise<boolean> {
  if (process.stdin.isTTY) return false;

  const firstChunk = await new Promise<Buffer | null>((resolve) => {
    let settled = false;
    const onData = (chunk: string | Buffer): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    };
    const onEnd = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(null);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.alloc(0));
    }, 30);
    const cleanup = (): void => {
      clearTimeout(timer);
      process.stdin.off('data', onData);
      process.stdin.off('end', onEnd);
    };

    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.resume();
  });

  if (firstChunk === null || firstChunk.length === 0) {
    return false;
  }

  const firstText = firstChunk.toString('utf-8');
  if (!firstText.trimStart().startsWith('{')) {
    process.stdin.unshift(firstChunk);
    return false;
  }

  let payload = firstText;
  for await (const chunk of process.stdin) {
    payload += (typeof chunk === 'string' ? chunk : chunk.toString('utf-8'));
  }

  const trimmed = payload.trim();
  let request: SimpleJsonRpcRequest;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      const error = simpleJsonRpcError(null, -32600, 'Invalid Request');
      process.stdout.write(`${JSON.stringify(error)}\n`);
      return true;
    }
    request = parsed as SimpleJsonRpcRequest;
  } catch {
    const error = simpleJsonRpcError(null, -32700, 'Parse error');
    process.stdout.write(`${JSON.stringify(error)}\n`);
    return true;
  }

  const response = await handleSimpleJsonRpcRequest(request);
  process.stdout.write(`${JSON.stringify(response)}\n`);
  return true;
}

async function main() {
  if (process.argv[2] === 'ingest') {
    await runIngestCli(process.argv.slice(3));
    return;
  }

  try {
    await ensureNdsDb();
  } catch (err) {
    console.error('[nds-mcp] Failed to ensure database:',
      err instanceof Error ? err.message : String(err));
    console.error('[nds-mcp] Set NDS_DB_PATH=/path/to/nds.sqlite to configure manually');
    process.exitCode = 1;
    return;
  }

  if (await maybeServeSimpleJsonRpcOnce()) {
    console.error('[nds-mcp] Served one-shot simple JSON-RPC request');
    return;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[nds-mcp] Server started');
}

const isExecutedAsScript = (() => {
  try {
    const entryPath = process.argv[1] ? realpathSync(process.argv[1]) : '';
    const modulePath = fileURLToPath(import.meta.url);
    return entryPath === modulePath;
  } catch {
    return false;
  }
})();

if (isExecutedAsScript) {
  main().catch(err => {
    console.error('[nds-mcp] Fatal:', err);
    process.exitCode = 1;
  });
}
