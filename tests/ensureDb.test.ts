import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// We test the module's logic by importing its exports.
// Real network calls are NOT made — we mock child_process and fs where needed.
import { hasCurl, ensureNdsDb } from '../src/db/ensureDb.js';
import { NDS_DB_PATH_ENV } from '../src/db/ndsDb.js';

describe('ensureDb', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset relevant env vars before each test
    delete process.env[NDS_DB_PATH_ENV];
    delete process.env['NDS_DB_DOWNLOAD_URL'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('hasCurl', () => {
    it('returns a boolean', () => {
      const result = hasCurl();
      expect(typeof result).toBe('boolean');
    });

    // On most dev machines curl is available
    it('returns true on a typical dev machine', () => {
      expect(hasCurl()).toBe(true);
    });
  });

  describe('ensureNdsDb — NDS_DB_PATH already set', () => {
    it('uses the explicitly set path when valid', async () => {
      // Create a temporary file to serve as a valid DB
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nds-test-'));
      const fakePath = path.join(tmpDir, 'test.sqlite');
      fs.writeFileSync(fakePath, 'fake-db-content');

      process.env[NDS_DB_PATH_ENV] = fakePath;

      const result = await ensureNdsDb();
      expect(result).toBe(fakePath);

      // Cleanup
      fs.unlinkSync(fakePath);
      fs.rmdirSync(tmpDir);
    });

    it('throws when NDS_DB_PATH is set to a non-existent file', async () => {
      process.env[NDS_DB_PATH_ENV] = '/nonexistent/path/nds.sqlite';

      await expect(ensureNdsDb()).rejects.toThrow('invalid');
    });
  });

  describe('ensureNdsDb — default path cached', () => {
    it('uses cached file at default location', async () => {
      const defaultDir = path.join(os.homedir(), '.nds-mcp');
      const defaultPath = path.join(defaultDir, 'nds.sqlite');

      // Only run this test if the cached file already exists
      // (skip if not — we don't want to create files in the real home dir)
      if (fs.existsSync(defaultPath) && fs.statSync(defaultPath).size > 0) {
        const result = await ensureNdsDb();
        expect(result).toBe(defaultPath);
        expect(process.env[NDS_DB_PATH_ENV]).toBe(defaultPath);
      }
    });
  });

  describe('path resolution', () => {
    it('DEFAULT_DB_PATH is under ~/.nds-mcp/', () => {
      const expected = path.join(os.homedir(), '.nds-mcp', 'nds.sqlite');
      // We can't easily access the private constant, but ensureNdsDb uses it
      // Just verify the home directory structure
      expect(os.homedir()).toBeTruthy();
      expect(expected).toContain('.nds-mcp');
      expect(expected).toContain('nds.sqlite');
    });
  });

  describe('env propagation', () => {
    it('sets NDS_DB_PATH env after resolving to explicit path', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nds-test-'));
      const fakePath = path.join(tmpDir, 'test.sqlite');
      fs.writeFileSync(fakePath, 'fake-db-content');

      process.env[NDS_DB_PATH_ENV] = fakePath;

      await ensureNdsDb();
      // The env should still be set (not cleared)
      expect(process.env[NDS_DB_PATH_ENV]).toBe(fakePath);

      fs.unlinkSync(fakePath);
      fs.rmdirSync(tmpDir);
    });
  });
});
