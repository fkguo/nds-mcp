import * as fs from 'fs';
import * as path from 'path';
import { invalidParams } from '../shared/index.js';

export interface OptionalDbStatus {
  status: 'ok' | 'not_configured';
  path?: string;
  size_mb?: number;
  how_to: string;
}

function validateFilePath(filePath: string, envName: string): string {
  if (!path.isAbsolute(filePath)) {
    throw invalidParams(`${envName} must be an absolute path`, { env: envName, value: filePath });
  }

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw invalidParams(`${envName} does not exist`, { env: envName, value: resolved });
  }

  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw invalidParams(`${envName} must point to a file`, { env: envName, value: resolved });
  }

  return resolved;
}

export function resolvePathFromEnv(envName: string): string | undefined {
  const raw = process.env[envName];
  if (!raw || raw.trim().length === 0) return undefined;
  return validateFilePath(raw.trim(), envName);
}

export function resolveOptionalDbPath(envName: string, defaultPath: string): string | undefined {
  const envPath = resolvePathFromEnv(envName);
  if (envPath) return envPath;

  if (!fs.existsSync(defaultPath)) return undefined;
  const stat = fs.statSync(defaultPath);
  if (!stat.isFile()) {
    throw invalidParams(`Default DB path is not a file: ${defaultPath}`, { path: defaultPath });
  }
  return path.resolve(defaultPath);
}

export function describeOptionalDb(pathValue: string | undefined, howTo: string): OptionalDbStatus {
  if (!pathValue) {
    return { status: 'not_configured', how_to: howTo };
  }
  const stat = fs.statSync(pathValue);
  return {
    status: 'ok',
    path: pathValue,
    size_mb: Number((stat.size / (1024 * 1024)).toFixed(3)),
    how_to: howTo,
  };
}
