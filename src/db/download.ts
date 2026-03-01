import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import { execFileSync } from 'child_process';
import { pipeline } from 'stream/promises';

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

export async function downloadFile(
  url: string,
  destPath: string,
  label: string,
  options?: { timeoutMs?: number },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 10 * 60 * 1000;
  if (hasCurl()) {
    downloadWithCurl(url, destPath, label, timeoutMs);
    return;
  }
  await downloadWithNodeHttps(url, destPath, label, timeoutMs);
}
