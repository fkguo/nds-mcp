/**
 * Auto-download the NDS SQLite database on first use.
 *
 * Priority:
 *   1. NDS_DB_PATH env already set and valid → use it
 *   2. ~/.nds-mcp/nds.sqlite exists and non-empty → use it
 *   3. Download from GitHub Releases → atomic rename into place
 *
 * Download uses curl (preferred, handles proxy natively) with node:https fallback.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { execFileSync } from 'child_process';
import { pipeline } from 'stream/promises';

import { getNdsDbPathFromEnv, NDS_DB_PATH_ENV } from './ndsDb.js';

const DEFAULT_DATA_DIR = path.join(os.homedir(), '.nds-mcp');
const DEFAULT_DB_PATH = path.join(DEFAULT_DATA_DIR, 'nds.sqlite');

const DOWNLOAD_URL_ENV = 'NDS_DB_DOWNLOAD_URL';
const DEFAULT_DOWNLOAD_URL =
  'https://github.com/fkguo/nds-mcp/releases/latest/download/nds.sqlite';

/** Check if curl is available on the system. */
export function hasCurl(): boolean {
  try {
    execFileSync('curl', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Download a file using curl (synchronous).
 * curl natively supports https_proxy / http_proxy environment variables.
 */
function downloadWithCurl(url: string, destPath: string): void {
  console.error(`[nds-mcp] Downloading database with curl...`);
  console.error(`[nds-mcp]   URL: ${url}`);
  console.error(`[nds-mcp]   Dest: ${destPath}`);

  execFileSync('curl', ['-fSL', '--progress-bar', '-o', destPath, url], {
    stdio: ['ignore', 'ignore', 'inherit'],
    timeout: 10 * 60 * 1000, // 10 minutes
  });
}

/**
 * Download a file using node:https (async fallback).
 * Handles up to 5 redirects (GitHub Releases 302 → CDN).
 * Does NOT support proxy (known limitation — curl path is preferred).
 */
async function downloadWithNodeHttps(url: string, destPath: string): Promise<void> {
  console.error(`[nds-mcp] Downloading database with node:https...`);
  console.error(`[nds-mcp]   URL: ${url}`);
  console.error(`[nds-mcp]   Dest: ${destPath}`);

  const MAX_REDIRECTS = 5;
  let currentUrl = url;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const proto = currentUrl.startsWith('https:') ? https : http;
      const req = proto.get(currentUrl, resolve);
      req.on('error', reject);
      req.setTimeout(10 * 60 * 1000, () => {
        req.destroy(new Error('Download timed out'));
      });
    });

    const status = response.statusCode ?? 0;

    // Handle redirects
    if (status >= 300 && status < 400 && response.headers.location) {
      currentUrl = response.headers.location;
      response.resume(); // drain the response
      if (i === MAX_REDIRECTS) {
        throw new Error(`Too many redirects (>${MAX_REDIRECTS})`);
      }
      continue;
    }

    if (status !== 200) {
      response.resume();
      throw new Error(`HTTP ${status} from ${currentUrl}`);
    }

    // Stream to file
    const fileStream = fs.createWriteStream(destPath);
    await pipeline(response, fileStream);
    return;
  }
}

/**
 * Ensure the NDS SQLite database is available, downloading it if necessary.
 * Sets `process.env.NDS_DB_PATH` so downstream code can find it.
 *
 * @returns The absolute path to the database file.
 */
export async function ensureNdsDb(): Promise<string> {
  // 1. NDS_DB_PATH already set and valid
  try {
    const explicit = getNdsDbPathFromEnv();
    if (explicit) {
      return explicit;
    }
  } catch {
    // If NDS_DB_PATH is set but invalid, let the error propagate
    // only if the user explicitly set it (not our auto-set)
    if (process.env[NDS_DB_PATH_ENV]) {
      throw new Error(
        `${NDS_DB_PATH_ENV} is set to "${process.env[NDS_DB_PATH_ENV]}" but is invalid. ` +
        `Unset it to use auto-download, or fix the path.`
      );
    }
  }

  // 2. Default path exists and non-empty → use cached copy
  if (fs.existsSync(DEFAULT_DB_PATH)) {
    const stat = fs.statSync(DEFAULT_DB_PATH);
    if (stat.isFile() && stat.size > 0) {
      process.env[NDS_DB_PATH_ENV] = DEFAULT_DB_PATH;
      console.error(`[nds-mcp] Using cached database: ${DEFAULT_DB_PATH}`);
      return DEFAULT_DB_PATH;
    }
  }

  // 3. Download
  const url = process.env[DOWNLOAD_URL_ENV] || DEFAULT_DOWNLOAD_URL;
  fs.mkdirSync(DEFAULT_DATA_DIR, { recursive: true });

  const tmpPath = path.join(DEFAULT_DATA_DIR, `nds.sqlite.download.${process.pid}`);

  try {
    if (hasCurl()) {
      downloadWithCurl(url, tmpPath);
    } else {
      await downloadWithNodeHttps(url, tmpPath);
    }

    // Validate: downloaded file must be non-empty
    const stat = fs.statSync(tmpPath);
    if (stat.size === 0) {
      throw new Error('Downloaded file is empty');
    }

    // Atomic rename into place
    fs.renameSync(tmpPath, DEFAULT_DB_PATH);
    console.error(`[nds-mcp] Database downloaded: ${DEFAULT_DB_PATH} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);

    process.env[NDS_DB_PATH_ENV] = DEFAULT_DB_PATH;
    return DEFAULT_DB_PATH;
  } catch (err) {
    // Clean up temp file on failure
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}
