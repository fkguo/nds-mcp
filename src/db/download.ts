import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import { execFileSync } from 'child_process';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';

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
function downloadWithCurl(url: string, destPath: string, label: string, timeoutMs: number): void {
  console.error(`[nds-mcp] Downloading ${label} with curl...`);
  console.error(`[nds-mcp]   URL: ${url}`);
  console.error(`[nds-mcp]   Dest: ${destPath}`);

  execFileSync('curl', ['-fSL', '--progress-bar', '-o', destPath, url], {
    stdio: ['ignore', 'ignore', 'inherit'],
    timeout: timeoutMs,
  });
}

/**
 * Download a file using node:https (async fallback).
 * Handles up to 5 redirects (GitHub Releases 302 → CDN).
 * Does NOT support proxy (known limitation — curl path is preferred).
 */
async function downloadWithNodeHttps(url: string, destPath: string, label: string, timeoutMs: number): Promise<void> {
  console.error(`[nds-mcp] Downloading ${label} with node:https...`);
  console.error(`[nds-mcp]   URL: ${url}`);
  console.error(`[nds-mcp]   Dest: ${destPath}`);

  const MAX_REDIRECTS = 5;
  let currentUrl = url;

  for (let i = 0; i <= MAX_REDIRECTS; i += 1) {
    const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const proto = currentUrl.startsWith('https:') ? https : http;
      const req = proto.get(currentUrl, resolve);
      req.on('error', reject);
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error('Download timed out'));
      });
    });

    const status = response.statusCode ?? 0;

    if (status >= 300 && status < 400 && response.headers.location) {
      currentUrl = response.headers.location;
      response.resume();
      if (i === MAX_REDIRECTS) {
        throw new Error(`Too many redirects (>${MAX_REDIRECTS})`);
      }
      continue;
    }

    if (status !== 200) {
      response.resume();
      throw new Error(`HTTP ${status} from ${currentUrl}`);
    }

    const fileStream = fs.createWriteStream(destPath);
    await pipeline(response, fileStream);
    return;
  }
}

function isGzipFile(filePath: string): boolean {
  const fd = fs.openSync(filePath, 'r');
  try {
    const magic = Buffer.alloc(2);
    const bytes = fs.readSync(fd, magic, 0, 2, 0);
    return bytes === 2 && magic[0] === 0x1f && magic[1] === 0x8b;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Auto-decompress downloaded gzip assets in-place.
 * This allows release assets to be published as *.sqlite.gz while local cache remains *.sqlite.
 */
async function maybeDecompressGzip(url: string, destPath: string, label: string): Promise<void> {
  const expectGzipByUrl = url.toLowerCase().endsWith('.gz');
  const expectGzipByMagic = isGzipFile(destPath);
  if (!expectGzipByUrl && !expectGzipByMagic) return;

  const unpackedPath = `${destPath}.gunzip.${process.pid}`;
  try {
    console.error(`[nds-mcp] Decompressing ${label} gzip asset...`);
    const input = fs.createReadStream(destPath);
    const output = fs.createWriteStream(unpackedPath);
    await pipeline(input, createGunzip(), output);
    fs.renameSync(unpackedPath, destPath);
  } catch (err) {
    try { fs.unlinkSync(unpackedPath); } catch { /* ignore */ }
    throw new Error(`Failed to gunzip downloaded ${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function downloadFile(
  url: string,
  destPath: string,
  label: string,
  options?: { timeoutMs?: number },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 10 * 60 * 1000;
  if (hasCurl()) {
    downloadWithCurl(url, destPath, label, timeoutMs);
    await maybeDecompressGzip(url, destPath, label);
    return;
  }
  await downloadWithNodeHttps(url, destPath, label, timeoutMs);
  await maybeDecompressGzip(url, destPath, label);
}
