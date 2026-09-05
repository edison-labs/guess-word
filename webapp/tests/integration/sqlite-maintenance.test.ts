import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('SQLite maintenance scripts', () => {
  it('creates an integrity-checked backup and restores it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'guess-word-backup-'));
    directories.push(directory);
    const databasePath = join(directory, 'game.sqlite');
    const backupDir = join(directory, 'backups');
    const database = new DatabaseSync(databasePath);
    database.exec("CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES ('before');");
    database.close();

    const backup = spawnSync(process.execPath, ['scripts/sqlite-backup.mjs'], {
      cwd: process.cwd(), encoding: 'utf8',
      env: { ...process.env, DATABASE_PATH: databasePath, SQLITE_BACKUP_DIR: backupDir },
    });
    expect(backup.status, backup.stderr).toBe(0);
    const backupPath = backup.stdout.trim().split('\n').at(-1)!;

    const changed = new DatabaseSync(databasePath);
    changed.exec("UPDATE sample SET value = 'after'");
    changed.close();
    const restore = spawnSync(process.execPath, ['scripts/sqlite-restore.mjs'], {
      cwd: process.cwd(), encoding: 'utf8',
      env: { ...process.env, DATABASE_PATH: databasePath, RESTORE_SOURCE: backupPath },
    });
    expect(restore.status, restore.stderr).toBe(0);
    const restored = new DatabaseSync(databasePath, { readOnly: true });
    expect(restored.prepare('SELECT value FROM sample').get()).toEqual({ value: 'before' });
    restored.close();
  });
});
