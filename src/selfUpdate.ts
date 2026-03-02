import * as https from 'https';
import * as http from 'http';
import { execFileSync } from 'child_process';
import * as fs from 'fs';

const DEFAULT_PACKAGE_NAME = 'nds-mcp';
const DEFAULT_REGISTRY_BASE = 'https://registry.npmjs.org';
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_UPDATE_TIMEOUT_MS = 10 * 60 * 1000;
const VERSION_FALLBACK = '0.2.0';

interface NpmRegistryResponse {
  'dist-tags'?: {
    latest?: string;
  };
}

export interface NpmUpdateInfo {
  package_name: string;
  current_version: string;
  latest_version: string;
  update_available: boolean;
  checked_at: string;
  recommend_command: string;
}

export interface NpmUpdateCheckOptions {
  packageName?: string;
  currentVersion?: string;
  registryBaseUrl?: string;
  timeoutMs?: number;
  fetchJson?: (url: string, timeoutMs: number) => Promise<unknown>;
}

export interface NpmSelfUpdateOptions {
  confirm: boolean;
  packageName?: string;
  target?: string;
  timeoutMs?: number;
  execNpm?: (args: string[], timeoutMs: number) => string;
}

export interface NpmSelfUpdateResult {
  package_name: string;
  target: string;
  command: string;
  output: string;
}

function parseSemver(version: string): [number, number, number] {
  const m = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!m) {
    throw new Error(`Invalid semver: ${version}`);
  }
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function compareSemver(a: string, b: string): number {
  const av = parseSemver(a);
  const bv = parseSemver(b);
  for (let i = 0; i < 3; i += 1) {
    if (av[i] > bv[i]) return 1;
    if (av[i] < bv[i]) return -1;
  }
  return 0;
}

function getPackageVersion(): string {
  const fromEnv = process.env.npm_package_version?.trim();
  if (fromEnv) return fromEnv;

  try {
    const packageJsonUrl = new URL('../package.json', import.meta.url);
    const parsed = JSON.parse(fs.readFileSync(packageJsonUrl, 'utf8')) as { version?: unknown };
    if (typeof parsed.version === 'string' && parsed.version.trim().length > 0) {
      return parsed.version.trim();
    }
  } catch {
    // ignore and fallback
  }
  return VERSION_FALLBACK;
}

async function fetchJsonDefault(url: string, timeoutMs: number): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const proto = url.startsWith('https:') ? https : http;
    const req = proto.get(url, { headers: { 'user-agent': 'nds-mcp-update-check' } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status !== 200) {
        res.resume();
        reject(new Error(`HTTP ${status} from ${url}`));
        return;
      }
      let payload = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { payload += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(payload));
        } catch {
          reject(new Error('Failed to parse npm registry JSON'));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Update check timed out')));
  });
}

export async function checkNpmUpdate(options?: NpmUpdateCheckOptions): Promise<NpmUpdateInfo> {
  const packageName = options?.packageName ?? DEFAULT_PACKAGE_NAME;
  const currentVersion = options?.currentVersion ?? getPackageVersion();
  const base = (options?.registryBaseUrl ?? DEFAULT_REGISTRY_BASE).replace(/\/+$/, '');
  const url = `${base}/${encodeURIComponent(packageName)}`;
  const fetchJson = options?.fetchJson ?? fetchJsonDefault;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const response = await fetchJson(url, timeoutMs) as NpmRegistryResponse;
  const latest = response?.['dist-tags']?.latest;
  if (!latest || typeof latest !== 'string') {
    throw new Error('npm registry response missing dist-tags.latest');
  }

  return {
    package_name: packageName,
    current_version: currentVersion,
    latest_version: latest,
    update_available: compareSemver(currentVersion, latest) < 0,
    checked_at: new Date().toISOString(),
    recommend_command: `npm install -g ${packageName}@latest`,
  };
}

function execNpmDefault(args: string[], timeoutMs: number): string {
  return execFileSync('npm', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
  });
}

export function runNpmSelfUpdate(options: NpmSelfUpdateOptions): NpmSelfUpdateResult {
  if (!options.confirm) {
    throw new Error('Self-update requires explicit confirm=true');
  }
  const packageName = options.packageName ?? DEFAULT_PACKAGE_NAME;
  const target = options.target ?? 'latest';
  const timeoutMs = options.timeoutMs ?? DEFAULT_UPDATE_TIMEOUT_MS;
  const execNpm = options.execNpm ?? execNpmDefault;
  const args = ['install', '-g', `${packageName}@${target}`];

  const output = execNpm(args, timeoutMs);
  return {
    package_name: packageName,
    target,
    command: `npm ${args.join(' ')}`,
    output,
  };
}
