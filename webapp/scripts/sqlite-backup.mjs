import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

const sourcePath = process.env.DATABASE_PATH || '/data/guess-word.sqlite';
const backupDir = process.env.SQLITE_BACKUP_DIR || join(dirname(sourcePath), 'backups');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destinationPath = join(backupDir, `guess-word-${stamp}.sqlite`);

mkdirSync(backupDir, { recursive: true, mode: 0o700 });
const source = new DatabaseSync(sourcePath, { readOnly: true });
try {
  assertHealthy(source, '源数据库');
  await backup(source, destinationPath);
} finally {
  source.close();
}

const copy = new DatabaseSync(destinationPath, { readOnly: true });
try { assertHealthy(copy, '备份文件'); }
finally { copy.close(); }

console.log(destinationPath);

function assertHealthy(database, label) {
  const rows = database.prepare('PRAGMA quick_check').all();
  if (rows.length !== 1 || Object.values(rows[0])[0] !== 'ok') {
    throw new Error(`${label}完整性检查失败。`);
  }
}
