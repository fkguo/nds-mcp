import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { execFileSync } from 'child_process';

export interface Jendl5XsPoint {
  point_index: number;
  e_eV: number;
  sigma_b: number;
}

export interface Jendl5XsInterp {
  nbt: number;
  int_law: number;
}

export interface Jendl5XsRecord {
  Z: number;
  A: number;
  state: number;
  projectile: 'n' | 'p';
  mt: number;
  reaction: string;
  e_min_eV: number;
  e_max_eV: number;
  points: Jendl5XsPoint[];
  interp: Jendl5XsInterp[];
}

interface EndfLine {
  data: string;
  mat: number;
  mf: number;
  mt: number;
}

interface EndfParseHints {
  sourceName?: string;
  projectile?: 'n' | 'p';
  state?: number;
}

const XS_TEXT_FILE_RE = /\.(dat|endf|txt)$/i;
const XS_GZIP_FILE_RE = /\.(dat|endf|txt)\.gz$/i;
const XS_JSON_FILE_RE = /\.(json|jsonl)$/i;

function parseJsonRecord(content: string): Jendl5XsRecord {
  return JSON.parse(content) as Jendl5XsRecord;
}

function parseJsonl(content: string): Jendl5XsRecord[] {
  const out: Jendl5XsRecord[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    out.push(parseJsonRecord(line));
  }
  return out;
}

export function parseJendl5XsFile(content: string): Jendl5XsRecord {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) {
    throw new Error('Unsupported XS file format. Expected JSON object or JSONL.');
  }
  return parseJsonRecord(trimmed);
}

function parseEndfFloat(field: string): number {
  const raw = field.trim();
  if (raw.length === 0) return 0;
  if (/^[+-]?\d+$/.test(raw)) return Number(raw);
  if (/^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(raw)) return Number(raw);
  const m = raw.match(/^([+-]?\d*\.?\d+)([+-]\d+)$/);
  if (m) return Number(`${m[1]}e${m[2]}`);
  throw new Error(`Invalid ENDF float field: "${field}"`);
}

function parseEndfInt(field: string): number {
  const raw = field.trim();
  if (raw.length === 0) return 0;
  if (!/^[+-]?\d+$/.test(raw)) {
    throw new Error(`Invalid ENDF integer field: "${field}"`);
  }
  return Number(raw);
}

function parseEndfLine(rawLine: string): EndfLine | null {
  if (rawLine.length < 75) return null;
  const data = rawLine.slice(0, 66);
  const matRaw = rawLine.slice(66, 70).trim();
  const mfRaw = rawLine.slice(70, 72).trim();
  const mtRaw = rawLine.slice(72, 75).trim();
  if (matRaw.length === 0 || mfRaw.length === 0 || mtRaw.length === 0) return null;
  if (!/^\d+$/.test(matRaw) || !/^\d+$/.test(mfRaw) || !/^\d+$/.test(mtRaw)) return null;
  return {
    data,
    mat: Number(matRaw),
    mf: Number(mfRaw),
    mt: Number(mtRaw),
  };
}

function inferProjectileFromName(sourceName?: string): 'n' | 'p' {
  if (!sourceName) return 'n';
  const base = path.basename(sourceName).toLowerCase();
  if (base.startsWith('p_')) return 'p';
  return 'n';
}

function inferStateFromName(sourceName?: string): number {
  if (!sourceName) return 0;
  const base = path.basename(sourceName).toLowerCase();
  const m = base.match(/-\d+(m(\d+)?)?(?:[_\.]|$)/);
  if (!m || !m[1]) return 0;
  if (!m[2]) return 1;
  const state = Number(m[2]);
  return Number.isFinite(state) && state > 0 ? state : 1;
}

function reactionLabelFor(projectile: 'n' | 'p', mt: number): string {
  if (projectile === 'n') {
    if (mt === 1) return 'n,total';
    if (mt === 2) return 'n,elastic';
    if (mt === 3) return 'n,nonelastic';
    if (mt === 4) return 'n,n\'';
    if (mt === 16) return 'n,2n';
    if (mt === 17) return 'n,3n';
    if (mt === 18) return 'n,fission';
    if (mt === 22) return 'n,na';
    if (mt === 28) return 'n,np';
    if (mt === 102) return 'n,gamma';
    if (mt === 103) return 'n,p';
    if (mt === 104) return 'n,d';
    if (mt === 105) return 'n,t';
    if (mt === 106) return 'n,He3';
    if (mt === 107) return 'n,a';
    if (mt >= 51 && mt <= 91) return `n,n${mt - 50}`;
  }
  return `${projectile},mt${mt}`;
}

function parseTab1Section(
  lines: EndfLine[],
  mt: number,
  hints: Required<Pick<EndfParseHints, 'projectile' | 'state' | 'sourceName'>>,
): Jendl5XsRecord {
  if (lines.length < 3) {
    throw new Error(`MF=3 MT=${mt} section is too short`);
  }

  const za = Math.round(parseEndfFloat(lines[0]!.data.slice(0, 11)));
  if (!Number.isFinite(za) || za <= 0) {
    throw new Error(`MF=3 MT=${mt} has invalid ZA: ${lines[0]!.data.slice(0, 11).trim()}`);
  }
  const Z = Math.floor(za / 1000);
  const A = za - Z * 1000;

  const nr = parseEndfInt(lines[1]!.data.slice(44, 55));
  const np = parseEndfInt(lines[1]!.data.slice(55, 66));
  if (nr < 1) {
    throw new Error(`MF=3 MT=${mt} has invalid NR=${nr}`);
  }
  if (np < 2) {
    throw new Error(`MF=3 MT=${mt} has invalid NP=${np}`);
  }

  const interpLineCount = Math.ceil((nr * 2) / 6);
  const pointLineCount = Math.ceil((np * 2) / 6);
  const requiredLines = 2 + interpLineCount + pointLineCount;
  if (lines.length < requiredLines) {
    throw new Error(`MF=3 MT=${mt} ended early while parsing TAB1 payload`);
  }

  const readBlockFields = (startLine: number, lineCount: number): string[] => {
    const fields: string[] = [];
    for (let li = 0; li < lineCount; li += 1) {
      const line = lines[startLine + li]!;
      for (let fi = 0; fi < 6; fi += 1) {
        fields.push(line.data.slice(fi * 11, (fi + 1) * 11));
      }
    }
    return fields;
  };

  const interpFields = readBlockFields(2, interpLineCount);
  const interpRaw: number[] = [];
  for (let i = 0; i < nr * 2; i += 1) {
    interpRaw.push(parseEndfInt(interpFields[i]!));
  }
  const interp: Jendl5XsInterp[] = [];
  for (let i = 0; i < interpRaw.length; i += 2) {
    interp.push({
      nbt: interpRaw[i]!,
      int_law: interpRaw[i + 1]!,
    });
  }

  const pointFields = readBlockFields(2 + interpLineCount, pointLineCount);
  const pointRaw: number[] = [];
  for (let i = 0; i < np * 2; i += 1) {
    pointRaw.push(parseEndfFloat(pointFields[i]!));
  }
  const points: Jendl5XsPoint[] = [];
  for (let i = 0; i < pointRaw.length; i += 2) {
    points.push({
      point_index: (i / 2) + 1,
      e_eV: pointRaw[i]!,
      sigma_b: pointRaw[i + 1]!,
    });
  }

  for (let i = 1; i < points.length; i += 1) {
    if (points[i]!.e_eV < points[i - 1]!.e_eV) {
      throw new Error(`MF=3 MT=${mt} has non-monotonic energy grid in ${hints.sourceName}`);
    }
  }

  return {
    Z,
    A,
    state: hints.state,
    projectile: hints.projectile,
    mt,
    reaction: reactionLabelFor(hints.projectile, mt),
    e_min_eV: points[0]!.e_eV,
    e_max_eV: points[points.length - 1]!.e_eV,
    points,
    interp,
  };
}

export function parseJendl5XsEndfText(content: string, hints: EndfParseHints = {}): Jendl5XsRecord[] {
  const sourceName = hints.sourceName ?? 'ENDF-6 text';
  const projectile = hints.projectile ?? inferProjectileFromName(sourceName);
  const state = hints.state ?? inferStateFromName(sourceName);

  const parsedLines = content
    .split(/\r?\n/)
    .map((line) => parseEndfLine(line))
    .filter((line): line is EndfLine => line !== null);

  const records: Jendl5XsRecord[] = [];
  let currentMt: number | null = null;
  let currentLines: EndfLine[] = [];

  const flush = (): void => {
    if (currentMt === null || currentMt <= 0 || currentLines.length === 0) return;
    const head = currentLines[0]!;
    if (head.mf !== 3) {
      currentMt = null;
      currentLines = [];
      return;
    }
    records.push(parseTab1Section(currentLines, currentMt, { projectile, state, sourceName }));
    currentMt = null;
    currentLines = [];
  };

  for (const line of parsedLines) {
    if (line.mf !== 3) continue;
    if (line.mt === 0) {
      flush();
      continue;
    }
    if (currentMt === null) {
      currentMt = line.mt;
      currentLines = [line];
      continue;
    }
    if (line.mt !== currentMt) {
      flush();
      currentMt = line.mt;
      currentLines = [line];
      continue;
    }
    currentLines.push(line);
  }
  flush();

  if (records.length === 0) {
    throw new Error(`No MF=3 cross section sections found in ${sourceName}`);
  }
  return records;
}

function parseXsDataBuffer(buffer: Buffer, sourceName: string): Jendl5XsRecord[] {
  const lower = sourceName.toLowerCase();
  if (lower.endsWith('.jsonl')) {
    return parseJsonl(buffer.toString('utf-8'));
  }
  if (lower.endsWith('.json')) {
    return [parseJsonRecord(buffer.toString('utf-8'))];
  }
  const decoded = lower.endsWith('.gz') ? zlib.gunzipSync(buffer) : buffer;
  try {
    return parseJendl5XsEndfText(decoded.toString('utf-8'), { sourceName });
  } catch (error) {
    if ((lower.endsWith('.txt') || lower.endsWith('.txt.gz'))
      && error instanceof Error
      && error.message.startsWith('No MF=3 cross section sections found')) {
      return [];
    }
    throw error;
  }
}

function isXsDataEntry(entry: string): boolean {
  return XS_JSON_FILE_RE.test(entry) || XS_TEXT_FILE_RE.test(entry) || XS_GZIP_FILE_RE.test(entry);
}

export async function* parseJendl5XsArchive(tarGzBuffer: Buffer): AsyncIterable<Jendl5XsRecord> {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jendl5-xs-'));
  const archivePath = path.join(tmpRoot, 'input.tar.gz');
  fs.writeFileSync(archivePath, tarGzBuffer);

  try {
    for await (const record of parseJendl5XsArchiveFile(archivePath)) {
      yield record;
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

export function parseJendl5XsJsonl(content: string): Jendl5XsRecord[] {
  return parseJsonl(content);
}

function walkDirectory(root: string): string[] {
  const out: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
      } else if (entry.isFile() && isXsDataEntry(entry.name)) {
        out.push(fullPath);
      }
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function parseJendl5XsDirectory(dirPath: string): Jendl5XsRecord[] {
  const out: Jendl5XsRecord[] = [];
  for (const record of parseJendl5XsDirectoryRecords(dirPath)) {
    out.push(record);
  }
  return out;
}

export async function* parseJendl5XsArchiveFile(archivePath: string): AsyncIterable<Jendl5XsRecord> {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jendl5-xs-archive-'));
  try {
    // Unpack once, then parse files from local disk (O(N)).
    try {
      execFileSync('tar', ['-xzf', archivePath, '-C', tmpRoot], { stdio: 'inherit' });
    } catch {
      throw new Error(
        `Failed to extract archive: ${archivePath}. ` +
        'Likely insufficient tmp disk space. ' +
        'Workaround: extract archive manually to a directory and use that directory as --source.',
      );
    }

    const files = walkDirectory(tmpRoot);
    for (const filePath of files) {
      const relative = path.relative(tmpRoot, filePath);
      if (!isXsDataEntry(relative)) continue;
      const content = fs.readFileSync(filePath);
      const records = parseXsDataBuffer(content, relative);
      for (const record of records) {
        yield record;
      }
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

export function* parseJendl5XsDirectoryRecords(dirPath: string): Iterable<Jendl5XsRecord> {
  const files = walkDirectory(dirPath);
  for (const filePath of files) {
    const content = fs.readFileSync(filePath);
    const relative = path.relative(dirPath, filePath);
    const records = parseXsDataBuffer(content, relative);
    for (const record of records) {
      yield record;
    }
  }
}
