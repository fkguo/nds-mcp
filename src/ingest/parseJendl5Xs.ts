import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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

export async function* parseJendl5XsArchive(tarGzBuffer: Buffer): AsyncIterable<Jendl5XsRecord> {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jendl5-xs-'));
  const archivePath = path.join(tmpRoot, 'input.tar.gz');
  fs.writeFileSync(archivePath, tarGzBuffer);

  try {
    const listing = execFileSync('tar', ['-tzf', archivePath], { encoding: 'utf-8' })
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.endsWith('.json') || line.endsWith('.jsonl'));

    for (const entry of listing) {
      const content = execFileSync('tar', ['-xOf', archivePath, entry], { encoding: 'utf-8' });
      if (entry.endsWith('.jsonl')) {
        for (const record of parseJsonl(content)) {
          yield record;
        }
      } else {
        yield parseJendl5XsFile(content);
      }
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

export function parseJendl5XsJsonl(content: string): Jendl5XsRecord[] {
  return parseJsonl(content);
}
