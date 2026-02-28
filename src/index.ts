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

const TOOL_MODE: ToolExposureMode = process.env.NDS_TOOL_MODE === 'full' ? 'full' : 'standard';

const server = new Server(
  {
    name: 'nds-mcp',
    version: '0.1.1',
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

async function main() {
  try {
    await ensureNdsDb();
  } catch (err) {
    console.error('[nds-mcp] Failed to ensure database:',
      err instanceof Error ? err.message : String(err));
    console.error('[nds-mcp] Set NDS_DB_PATH=/path/to/nds.sqlite to configure manually');
    process.exitCode = 1;
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
