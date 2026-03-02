import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { buildRequiredLibraryMeta, detectSourceKind } from './metaContract.js';
import { runSql, sqlEscape, streamXsRecords } from './jendl5DbCore.js';

function buildMetaUpsertSql(tableName: string, meta: Record<string, string>): string {
  return Object.entries(meta)
    .map(([key, value]) => (
      `INSERT OR REPLACE INTO ${tableName}(key, value) VALUES ('${sqlEscape(key)}', '${sqlEscape(value)}');`
    ))
    .join('\n');
}

export function ensureFendlSchema(dbPath: string): void {
  runSql(
    dbPath,
    `
CREATE TABLE IF NOT EXISTS fendl_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS fendl_raw_archives (
  id INTEGER PRIMARY KEY,
  rel_path TEXT NOT NULL UNIQUE,
  projectile TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  content BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS fendl_xs_meta (
  id INTEGER PRIMARY KEY,
  Z INTEGER NOT NULL,
  A INTEGER NOT NULL,
  state INTEGER NOT NULL DEFAULT 0,
  projectile TEXT NOT NULL,
  mt INTEGER NOT NULL,
  reaction TEXT NOT NULL,
  e_min_eV REAL NOT NULL,
  e_max_eV REAL NOT NULL,
  n_points INTEGER NOT NULL,
  UNIQUE(Z, A, state, projectile, mt)
);
CREATE TABLE IF NOT EXISTS fendl_xs_points (
  id INTEGER PRIMARY KEY,
  xs_id INTEGER NOT NULL REFERENCES fendl_xs_meta(id),
  point_index INTEGER NOT NULL,
  e_eV REAL NOT NULL,
  sigma_b REAL NOT NULL,
  UNIQUE(xs_id, point_index)
);
CREATE TABLE IF NOT EXISTS fendl_xs_interp (
  id INTEGER PRIMARY KEY,
  xs_id INTEGER NOT NULL REFERENCES fendl_xs_meta(id),
  nbt INTEGER NOT NULL,
  int_law INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fendl_raw_archives_projectile ON fendl_raw_archives(projectile);
CREATE INDEX IF NOT EXISTS idx_fendl_xs_meta_za ON fendl_xs_meta(Z, A, projectile, state);
CREATE INDEX IF NOT EXISTS idx_fendl_xs_points_xs ON fendl_xs_points(xs_id, e_eV);
`,
  );
}

interface SourceZipFile {
  absolutePath: string;
  relativePath: string;
}

function walkZipFiles(root: string): SourceZipFile[] {
  const out: SourceZipFile[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.zip')) {
        out.push({
          absolutePath: fullPath,
          relativePath: path.relative(root, fullPath),
        });
      }
    }
  }
  return out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function inferProjectileFromArchivePath(filePath: string): string {
  const base = path.basename(filePath).toLowerCase();
  if (base.startsWith('n_')) return 'n';
  if (base.startsWith('p_')) return 'p';
  if (base.startsWith('d_')) return 'd';
  if (base.startsWith('t_')) return 't';
  if (base.startsWith('h_') || base.startsWith('he3_')) return 'h';
  if (base.startsWith('a_') || base.startsWith('he4_')) return 'a';
  if (base.startsWith('g_')) return 'g';
  if (base.startsWith('photo_')) return 'photo';
  return 'unknown';
}

function sha256File(filePath: string): string {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function collectZipFiles(sourcePath: string): { files: SourceZipFile[]; cleanupPath?: string } {
  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    return { files: walkZipFiles(sourcePath) };
  }

  const lower = sourcePath.toLowerCase();
  if (lower.endsWith('.zip')) {
    return {
      files: [{
        absolutePath: sourcePath,
        relativePath: path.basename(sourcePath),
      }],
    };
  }

  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fendl-raw-archive-'));
    execFileSync('tar', ['-xzf', sourcePath, '-C', tmpRoot], { stdio: 'pipe' });
    return { files: walkZipFiles(tmpRoot), cleanupPath: tmpRoot };
  }

  return { files: [] };
}

function ingestRawArchives(dbPath: string, sourcePath: string): { archives: number; totalBytes: number } {
  const { files, cleanupPath } = collectZipFiles(sourcePath);
  let archives = 0;
  let totalBytes = 0;
  try {
    for (const file of files) {
      const sizeBytes = fs.statSync(file.absolutePath).size;
      const sha256 = sha256File(file.absolutePath);
      const projectile = inferProjectileFromArchivePath(file.relativePath);
      runSql(
        dbPath,
        `INSERT INTO fendl_raw_archives(rel_path, projectile, size_bytes, sha256, content)
         VALUES ('${sqlEscape(file.relativePath)}', '${sqlEscape(projectile)}', ${sizeBytes},
                 '${sqlEscape(sha256)}', readfile('${sqlEscape(path.resolve(file.absolutePath))}'));`,
      );
      archives += 1;
      totalBytes += sizeBytes;
      if (archives % 100 === 0) {
        console.error(`[nds-mcp] FENDL raw archive ingest progress: ${archives} archives`);
      }
    }
  } finally {
    if (cleanupPath) fs.rmSync(cleanupPath, { recursive: true, force: true });
  }
  return { archives, totalBytes };
}

function validateXsRecord(record: {
  Z: number;
  A: number;
  state: number;
  projectile: string;
  mt: number;
  reaction: string;
  points: Array<{ point_index: number; e_eV: number; sigma_b: number }>;
  interp: Array<{ nbt: number; int_law: number }>;
}): { eMin: number; eMax: number } {
  if (!Number.isInteger(record.Z) || record.Z < 0) throw new Error(`Invalid XS record Z=${record.Z}`);
  if (!Number.isInteger(record.A) || record.A < 0) throw new Error(`Invalid XS record A=${record.A}`);
  if (!Number.isInteger(record.state) || record.state < 0) throw new Error(`Invalid XS record state=${record.state}`);
  const allowedProjectiles = new Set(['n', 'p', 'd', 't', 'h', 'a', 'g', 'photo']);
  if (!allowedProjectiles.has(record.projectile)) {
    throw new Error(`Invalid XS projectile=${record.projectile}`);
  }
  if (!Number.isInteger(record.mt) || record.mt <= 0) throw new Error(`Invalid XS MT=${record.mt}`);
  if (record.reaction.trim().length === 0) throw new Error('Invalid XS reaction label (empty)');
  if (record.points.length < 2) throw new Error(`Invalid XS points for MT=${record.mt}: need at least 2`);
  if (record.interp.length < 1) throw new Error(`Invalid XS interpolation for MT=${record.mt}: need at least 1 segment`);

  let prevE = Number.NEGATIVE_INFINITY;
  for (const point of record.points) {
    if (!Number.isFinite(point.e_eV) || !Number.isFinite(point.sigma_b)) {
      throw new Error(`Invalid XS point in MT=${record.mt}: non-finite value`);
    }
    if (point.e_eV < prevE) {
      throw new Error(`Invalid XS energy grid in MT=${record.mt}: non-monotonic`);
    }
    prevE = point.e_eV;
  }

  const eMin = record.points[0]!.e_eV;
  const eMax = record.points[record.points.length - 1]!.e_eV;
  if (eMax < eMin) throw new Error(`Invalid XS energy range in MT=${record.mt}`);
  return { eMin, eMax };
}

export async function ingestFendl32c(
  dbPath: string,
  sourcePath: string,
  version = 'FENDL-3.2c',
): Promise<{ reactions: number; archives: number }> {
  ensureFendlSchema(dbPath);
  const requiredMeta = buildRequiredLibraryMeta({
    schemaVersion: '1',
    sourceKind: detectSourceKind(sourcePath),
    upstreamName: 'FENDL-3.2c',
    upstreamUrl: 'https://www-nds.iaea.org/fendl/',
    upstreamVersionOrSnapshot: version,
  });

  runSql(
    dbPath,
    `
BEGIN;
DELETE FROM fendl_raw_archives;
DELETE FROM fendl_xs_meta;
DELETE FROM fendl_xs_points;
DELETE FROM fendl_xs_interp;
${buildMetaUpsertSql('fendl_meta', requiredMeta)}
INSERT OR REPLACE INTO fendl_meta(key, value) VALUES ('fendl_schema_version', '1');
INSERT OR REPLACE INTO fendl_meta(key, value) VALUES ('fendl_version', '${sqlEscape(version)}');
COMMIT;
`,
  );

  const rawSummary = ingestRawArchives(dbPath, sourcePath);
  runSql(
    dbPath,
    `
INSERT OR REPLACE INTO fendl_meta(key, value) VALUES ('fendl_raw_archive_count', '${rawSummary.archives}');
INSERT OR REPLACE INTO fendl_meta(key, value) VALUES ('fendl_raw_archive_bytes', '${rawSummary.totalBytes}');
`,
  );

  let reactions = 0;
  for await (const record of streamXsRecords(sourcePath)) {
    const validated = validateXsRecord(record);
    const xsId = Number(execFileSync(
      'sqlite3',
      [
        dbPath,
        `INSERT INTO fendl_xs_meta(Z, A, state, projectile, mt, reaction, e_min_eV, e_max_eV, n_points)
         VALUES (${record.Z}, ${record.A}, ${record.state}, '${sqlEscape(record.projectile)}', ${record.mt},
                 '${sqlEscape(record.reaction)}', ${validated.eMin}, ${validated.eMax}, ${record.points.length});
         SELECT last_insert_rowid();`,
      ],
      { encoding: 'utf-8' },
    ).trim());

    const pointChunkSize = 5000;
    for (let start = 0; start < record.points.length; start += pointChunkSize) {
      const chunk = record.points.slice(start, start + pointChunkSize);
      const values = chunk
        .map((point) => `(${xsId}, ${point.point_index}, ${point.e_eV}, ${point.sigma_b})`)
        .join(',\n');
      runSql(
        dbPath,
        `INSERT INTO fendl_xs_points(xs_id, point_index, e_eV, sigma_b) VALUES\n${values};`,
      );
    }

    const interpValues = record.interp
      .map((segment) => `(${xsId}, ${segment.nbt}, ${segment.int_law})`)
      .join(',\n');
    runSql(
      dbPath,
      `INSERT INTO fendl_xs_interp(xs_id, nbt, int_law) VALUES\n${interpValues};`,
    );

    reactions += 1;
    if (reactions % 500 === 0) {
      console.error(`[nds-mcp] FENDL ingest progress: ${reactions} reactions`);
    }
  }

  if (reactions === 0) {
    throw new Error(`No FENDL XS records were ingested from source: ${sourcePath}`);
  }

  return { reactions, archives: rawSummary.archives };
}
