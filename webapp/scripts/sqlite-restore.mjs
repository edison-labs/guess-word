import { chmodSync, chownSync, copyFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const sourcePath = process.env.RESTORE_SOURCE || '/restore/backup.sqlite';
const destinationPath = process.env.DATABASE_PATH || '/data/guess-word.sqlite';
const temporaryPath = join(dirname(destinationPath), `.guess-word-restore-${process.pid}.sqlite`);

assertHealthy(sourcePath, '备份文件');
copyFileSync(sourcePath, temporaryPath);
chmodSync(temporaryPath, 0o600);
assertHealthy(temporaryPath, '待恢复数据库');
rmSync(`${destinationPath}-wal`, { force: true });
rmSync(`${destinationPath}-shm`, { force: true });
renameSync(temporaryPath, destinationPath);
chmodSync(destinationPath, 0o600);
if (process.getuid?.() === 0) chownSync(destinationPath, 1001, 1001);
console.log(`已从 ${sourcePath} 恢复到 ${destinationPath}`);

function assertHealthy(path, label) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = database.prepare('PRAGMA quick_check').all();
    if (rows.length !== 1 || Object.values(rows[0])[0] !== 'ok') throw new Error(`${label}完整性检查失败。`);
  } finally { database.close(); }
}
