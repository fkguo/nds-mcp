import * as fs from 'fs';
import { fileURLToPath } from 'url';

export type SourceKind = 'built_from_upstream' | 'imported_sqlite' | 'imported_jsonl';

const UNKNOWN = 'unknown';
let cachedGeneratorVersion: string | null = null;

function normalizeValue(value: string | undefined): string {
  if (value === undefined) return UNKNOWN;
  const trimmed = value.trim();
  return trimmed.length === 0 ? UNKNOWN : trimmed;
}

function readPackageVersionFromDisk(): string | null {
  try {
    const packageJsonPath = fileURLToPath(new URL('../../package.json', import.meta.url));
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as { version?: unknown };
    return typeof packageJson.version === 'string' && packageJson.version.trim().length > 0
      ? packageJson.version.trim()
      : null;
  } catch {
    return null;
  }
}

export function getGeneratorVersion(): string {
  if (cachedGeneratorVersion) return cachedGeneratorVersion;
  const fromEnv = process.env.npm_package_version?.trim();
  if (fromEnv && fromEnv.length > 0) {
    cachedGeneratorVersion = fromEnv;
    return cachedGeneratorVersion;
  }
  cachedGeneratorVersion = readPackageVersionFromDisk() ?? UNKNOWN;
  return cachedGeneratorVersion;
}

export function detectSourceKind(sourcePath: string): SourceKind {
  const lower = sourcePath.toLowerCase();
  if (lower.endsWith('.sqlite') || lower.endsWith('.db')) return 'imported_sqlite';
  if (lower.endsWith('.json') || lower.endsWith('.jsonl')) return 'imported_jsonl';
  return 'built_from_upstream';
}

export function normalizeMetaValues(meta: Record<string, string | undefined>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(meta)) {
    normalized[key] = normalizeValue(value);
  }
  return normalized;
}

export function buildRequiredLibraryMeta(input: {
  schemaVersion: string;
  sourceKind: SourceKind;
  upstreamName: string;
  upstreamUrl: string;
  upstreamVersionOrSnapshot?: string;
}): Record<string, string> {
  return normalizeMetaValues({
    schema_version: input.schemaVersion,
    built_at: new Date().toISOString(),
    generator: 'nds-mcp',
    generator_version: getGeneratorVersion(),
    source_kind: input.sourceKind,
    upstream_name: input.upstreamName,
    upstream_url: input.upstreamUrl,
    upstream_version_or_snapshot: input.upstreamVersionOrSnapshot,
  });
}
