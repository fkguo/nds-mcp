import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { invalidParams } from '../shared/index.js';
import { describeOptionalDb, resolveOptionalDbPath, resolvePathFromEnv, type OptionalDbStatus } from './dbPathCommon.js';

export const NDS_DB_PATH_ENV = 'NDS_DB_PATH';
export const DEFAULT_NDS_DB_PATH = path.join(os.homedir(), '.nds-mcp', 'nds.sqlite');

let sha256Cache:
  | { filePath: string; sizeBytes: number; mtimeMs: number; sha256: string }
  | undefined;

export function getNdsDbPathFromEnv(): string | undefined {
  return resolvePathFromEnv(NDS_DB_PATH_ENV);
}

export function getNdsDbPath(): string | undefined {
  return resolveOptionalDbPath(NDS_DB_PATH_ENV, DEFAULT_NDS_DB_PATH);
}

export function requireNdsDbPathFromEnv(): string {
  const p = getNdsDbPath();
  if (!p) {
    throw invalidParams(
      `${NDS_DB_PATH_ENV} is required. Auto-download may have failed at startup.`,
      {
        env: NDS_DB_PATH_ENV,
        how_to: 'Set NDS_DB_PATH=/abs/path/to/nds.sqlite or ensure internet access',
      },
    );
  }
  return p;
}

export function getMainDbStatus(): OptionalDbStatus {
  return describeOptionalDb(
    getNdsDbPath(),
    'Set NDS_DB_PATH=/abs/path/to/nds.sqlite or run nds-mcp to auto-download',
  );
}

export async function sha256File(filePath: string): Promise<string> {
  const stat = fs.statSync(filePath);
  if (
    sha256Cache &&
    sha256Cache.filePath === filePath &&
    sha256Cache.sizeBytes === stat.size &&
    sha256Cache.mtimeMs === stat.mtimeMs
  ) {
    return sha256Cache.sha256;
  }

  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  const digest = hash.digest('hex');

  sha256Cache = { filePath, sizeBytes: stat.size, mtimeMs: stat.mtimeMs, sha256: digest };
  return digest;
}

export async function getFileMetadata(filePath: string): Promise<{
  size_bytes: number;
  mtime_iso: string;
  sha256: string;
}> {
  const stat = fs.statSync(filePath);
  const digest = await sha256File(filePath);
  return {
    size_bytes: stat.size,
    mtime_iso: stat.mtime.toISOString(),
    sha256: digest,
  };
}
