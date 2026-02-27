import { ZodError } from 'zod';
import { invalidParams, McpError } from '../shared/index.js';
import type { ToolExposureMode, ToolSpec } from './registry.js';
import { getToolSpec, isToolExposed } from './registry.js';

export interface ToolCallContext {}

function parseToolArgs<T>(toolName: string, schema: { parse: (input: unknown) => T }, args: unknown): T {
  try {
    return schema.parse(args);
  } catch (err) {
    if (err instanceof ZodError) {
      throw invalidParams(`Invalid parameters for ${toolName}`, {
        issues: err.issues,
      });
    }
    throw err;
  }
}

function formatToolError(err: unknown): { content: { type: string; text: string }[]; isError: true } {
  const payload = (() => {
    if (err instanceof McpError) {
      // Redact SQL text from error data (Codex review finding)
      const data = err.data as Record<string, unknown> | undefined;
      const sanitized = data ? { ...data } : undefined;
      if (sanitized && 'sql' in sanitized) {
        delete sanitized.sql;
      }
      return {
        error: {
          code: err.code,
          message: err.message,
          ...(sanitized && Object.keys(sanitized).length > 0 ? { data: sanitized } : {}),
        },
      };
    }

    const message = err instanceof Error ? err.message : String(err);
    return {
      error: {
        code: 'INTERNAL_ERROR',
        message,
      },
    };
  })();

  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    isError: true,
  };
}

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  mode: ToolExposureMode = 'standard',
  _ctx?: ToolCallContext
): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
  try {
    const spec = getToolSpec(name);
    if (!spec) {
      throw invalidParams(`Unknown tool: ${name}`);
    }
    if (!isToolExposed(spec, mode)) {
      throw invalidParams(`Tool not exposed in ${mode} mode: ${name}`);
    }

    const parsedArgs = parseToolArgs(name, spec.zodSchema, args);
    const result = await (spec as ToolSpec<typeof spec.zodSchema>).handler(parsedArgs, {});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return formatToolError(err);
  }
}
