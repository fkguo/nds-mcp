import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_DDEP_DB_PATH } from '../db/ddepDb.js';
import { DEFAULT_EXFOR_DB_PATH } from '../db/exforDb.js';
import { DEFAULT_JENDL5_DB_PATH } from '../db/jendl5Db.js';
import { DEFAULT_NDS_DB_PATH } from '../db/ndsDb.js';
import { atomicWriteSqlite, ingestJendl5Decay, ingestJendl5Xs } from './buildJendl5Db.js';
import { ingestExfor } from './buildExforDb.js';
import { ingestDdep } from './buildDdepDb.js';
import { DEFAULT_CODATA_ASCII_URL, ingestCodata } from './buildCodataDb.js';

interface IngestArgs {
  jendl5Dec: boolean;
  jendl5Xs: boolean;
  exfor: boolean;
  ddep: boolean;
  codata: boolean;
  all: boolean;
  output?: string;
  source?: string;
  decSource?: string;
  xsSource?: string;
  exforSource?: string;
  ddepSource?: string;
  ddepRelease?: string;
  codataSource?: string;
}

function parseArgs(argv: string[]): IngestArgs {
  const out: IngestArgs = {
    jendl5Dec: false,
    jendl5Xs: false,
    exfor: false,
    ddep: false,
    codata: false,
    all: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--jendl5-dec') out.jendl5Dec = true;
    else if (arg === '--jendl5-xs') out.jendl5Xs = true;
    else if (arg === '--exfor') out.exfor = true;
    else if (arg === '--ddep') out.ddep = true;
    else if (arg === '--codata') out.codata = true;
    else if (arg === '--all') out.all = true;
    else if (arg === '--output') out.output = argv[++index];
    else if (arg === '--source') out.source = argv[++index];
    else if (arg === '--dec-source') out.decSource = argv[++index];
    else if (arg === '--xs-source') out.xsSource = argv[++index];
    else if (arg === '--exfor-source') out.exforSource = argv[++index];
    else if (arg === '--ddep-source') out.ddepSource = argv[++index];
    else if (arg === '--ddep-release') out.ddepRelease = argv[++index];
    else if (arg === '--codata-source') out.codataSource = argv[++index];
    else if (arg === '--help' || arg === '-h') throw new Error('help');
    else throw new Error(`Unknown arg: ${arg}`);
  }
  return out;
}

function usage(): string {
  return [
    'Usage:',
    '  nds-mcp ingest --jendl5-dec --source <path> [--output ~/.nds-mcp/jendl5.sqlite]',
    '  nds-mcp ingest --jendl5-xs --source <path-to-jsonl|path-to-tar|path-to-dir|path-to-endf(.gz)> [--output ~/.nds-mcp/jendl5.sqlite]',
    '  nds-mcp ingest --exfor --source <path> [--output ~/.nds-mcp/exfor.sqlite]',
    '  nds-mcp ingest --ddep --source <path> [--output ~/.nds-mcp/ddep.sqlite]',
    '  nds-mcp ingest --codata [--source <path-or-url>] [--output ~/.nds-mcp/nds.sqlite]',
    `  nds-mcp ingest --codata --source ${DEFAULT_CODATA_ASCII_URL}`,
    '  nds-mcp ingest --all --dec-source <path> --xs-source <path> --exfor-source <path> --ddep-source <path> [--codata-source <path-or-url>]',
  ].join('\n');
}

function requireSource(label: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required source for ${label}`);
  return path.resolve(value);
}

export async function runIngestCli(argv: string[]): Promise<void> {
  let args: IngestArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'help') {
      console.error(usage());
      return;
    }
    throw new Error(`${message}\n${usage()}`);
  }

  if (args.all) {
    args.jendl5Dec = true;
    args.jendl5Xs = true;
    args.exfor = true;
    args.ddep = true;
    args.codata = true;
  }
  if (!args.jendl5Dec && !args.jendl5Xs && !args.exfor && !args.ddep && !args.codata) {
    throw new Error(`No ingest target selected.\n${usage()}`);
  }

  if (args.jendl5Dec || args.jendl5Xs) {
    const output = path.resolve(args.output ?? DEFAULT_JENDL5_DB_PATH);
    const decSource = args.decSource ?? args.source;
    const xsSource = args.xsSource ?? args.source;

    const result = await atomicWriteSqlite(output, async (tmpPath) => {
      const summary: Record<string, unknown> = { output };
      if (args.jendl5Dec) {
        const ingestResult = await ingestJendl5Decay(tmpPath, requireSource('jendl5-dec', decSource), 'upd-5');
        summary.jendl5_dec = ingestResult;
      }
      if (args.jendl5Xs) {
        const ingestResult = await ingestJendl5Xs(tmpPath, requireSource('jendl5-xs', xsSource), '300K');
        summary.jendl5_xs = ingestResult;
      }
      return summary;
    });
    console.error('[nds-mcp] JENDL-5 ingest complete:', JSON.stringify(result));
  }

  if (args.exfor) {
    const output = path.resolve(args.output ?? DEFAULT_EXFOR_DB_PATH);
    const source = requireSource('exfor', args.exforSource ?? args.source);
    const result = await atomicWriteSqlite(output, (tmpPath) => ingestExfor(tmpPath, source));
    console.error('[nds-mcp] EXFOR ingest complete:', JSON.stringify({ output, ...result }));
  }

  if (args.ddep) {
    const output = path.resolve(args.output ?? DEFAULT_DDEP_DB_PATH);
    const source = requireSource('ddep', args.ddepSource ?? args.source);
    const ddepRelease = args.ddepRelease ?? 'rolling';
    const result = await atomicWriteSqlite(output, (tmpPath) => ingestDdep(tmpPath, source, ddepRelease));
    console.error('[nds-mcp] DDEP ingest complete:', JSON.stringify({ output, ddep_release: ddepRelease, ...result }));
  }

  if (args.codata) {
    const output = path.resolve(args.output ?? DEFAULT_NDS_DB_PATH);
    if (!fs.existsSync(output)) {
      throw new Error(
        `Main database not found: ${output}\n` +
        'CODATA now merges into nds.sqlite. Build/download nds.sqlite first, then rerun ingest --codata.',
      );
    }
    const source = args.codataSource ?? args.source ?? DEFAULT_CODATA_ASCII_URL;
    const resolvedSource = /^https?:\/\//i.test(source) ? source : path.resolve(source);
    const result = await atomicWriteSqlite(output, (tmpPath) => ingestCodata(tmpPath, resolvedSource));
    console.error('[nds-mcp] CODATA ingest complete:', JSON.stringify({ output, source: resolvedSource, ...result }));
  }
}
