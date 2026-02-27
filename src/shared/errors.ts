export type ErrorCode =
  | 'INVALID_PARAMS'
  | 'NOT_FOUND'
  | 'RATE_LIMIT'
  | 'UPSTREAM_ERROR'
  | 'INTERNAL_ERROR';

const RETRYABLE_BY_CODE: Record<ErrorCode, boolean> = {
  RATE_LIMIT: true,
  UPSTREAM_ERROR: true,
  INVALID_PARAMS: false,
  NOT_FOUND: false,
  INTERNAL_ERROR: false,
};

export class McpError extends Error {
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;

  constructor(
    public code: ErrorCode,
    message: string,
    public data?: unknown
  ) {
    super(message);
    this.name = 'McpError';
    this.retryable = RETRYABLE_BY_CODE[code];
    this.retryAfterMs = code === 'RATE_LIMIT' && data && typeof data === 'object' && 'retryAfter' in data
      ? (typeof (data as Record<string, unknown>).retryAfter === 'number'
        ? (data as Record<string, unknown>).retryAfter as number
        : undefined)
      : undefined;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.retryAfterMs !== undefined ? { retryAfterMs: this.retryAfterMs } : {}),
      data: this.data,
    };
  }
}

export function invalidParams(message: string, data?: unknown): McpError {
  return new McpError('INVALID_PARAMS', message, data);
}

export function notFound(message: string, data?: unknown): McpError {
  return new McpError('NOT_FOUND', message, data);
}

export function upstreamError(message: string, data?: unknown): McpError {
  return new McpError('UPSTREAM_ERROR', message, data);
}
