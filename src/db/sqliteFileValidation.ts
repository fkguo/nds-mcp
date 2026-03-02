import * as fs from 'fs';

const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'utf8');

export function assertSqliteHeader(filePath: string): void {
  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(SQLITE_HEADER.length);
    const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
    if (bytesRead < SQLITE_HEADER.length || !header.equals(SQLITE_HEADER)) {
      throw new Error(`Invalid SQLite file header: ${filePath}`);
    }
  } finally {
    fs.closeSync(fd);
  }
}

export async function validateSqliteFile(filePath: string): Promise<void> {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`Invalid DB file (missing or empty): ${filePath}`);
  }
  assertSqliteHeader(filePath);
}
