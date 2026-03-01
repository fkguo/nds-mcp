import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

export interface Jendl5DecayMode {
  rtyp: number;
  mode_label: string;
  q_keV: number | null;
  br: number;
}

export interface Jendl5RadiationItem {
  styp: number;
  type_label: string;
  lcon: number;
  component_kind: 'discrete_line' | 'continuous_summary';
  energy_keV: number | null;
  energy_unc_keV: number | null;
  endpoint_keV: number | null;
  intensity: number | null;
  intensity_unc: number | null;
}

export interface Jendl5DecayRecord {
  ZA: number;
  LIS: number;
  NST: number;
  halfLifeS: number | null;
  decayModes: Jendl5DecayMode[];
  spectra: Jendl5RadiationItem[];
}

function parseJsonRecord(content: string): Jendl5DecayRecord {
  const parsed = JSON.parse(content) as Jendl5DecayRecord;
  return parsed;
}

function parseJsonl(content: string): Jendl5DecayRecord[] {
  const records: Jendl5DecayRecord[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    records.push(parseJsonRecord(line));
  }
  return records;
}

export function parseJendl5DecFile(content: string): Jendl5DecayRecord {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) {
    throw new Error('Unsupported decay file format. Expected JSON object or JSONL.');
  }
  return parseJsonRecord(trimmed);
}

export async function* parseJendl5DecArchive(tarGzBuffer: Buffer): AsyncIterable<Jendl5DecayRecord> {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jendl5-dec-'));
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
        yield parseJendl5DecFile(content);
      }
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

export function parseJendl5DecJsonl(content: string): Jendl5DecayRecord[] {
  return parseJsonl(content);
}
