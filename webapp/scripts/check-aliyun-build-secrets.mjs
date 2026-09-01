import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const sentinel = 'guessword-aliyun-secret-sentinel-42c78d1e';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const build = spawnSync(npmCommand, ['run', 'build:aliyun'], {
  cwd: projectDirectory,
  env: {
    ...process.env,
    RUNTIME_PLATFORM: 'aliyun',
    APP_ENV: 'production',
    SEMANTIC_PROVIDER: 'deepseek-judge',
    DEEPSEEK_API_KEY: sentinel,
    DEEPSEEK_MODEL: 'deepseek-v4-flash',
    DATABASE_PATH: '/data/guess-word.sqlite',
    TEST_QUESTION_ID: '',
  },
  stdio: 'inherit',
});

if (build.error) throw build.error;
if (build.status !== 0) {
  throw new Error(`Alibaba Cloud sentinel build failed with exit code ${build.status}.`);
}

const roots = ['.next/standalone', '.next/static']
  .map((relativePath) => join(projectDirectory, relativePath))
  .filter(existsSync);
if (roots.length !== 2) throw new Error('Alibaba Cloud standalone output is incomplete.');

const leakedFiles = [];
function visit(path) {
  const info = statSync(path);
  if (info.isDirectory()) {
    for (const entry of readdirSync(path)) visit(join(path, entry));
    return;
  }
  if (readFileSync(path).includes(Buffer.from(sentinel))) leakedFiles.push(path);
}

for (const root of roots) visit(root);
if (leakedFiles.length > 0) {
  throw new Error(`Secret sentinel leaked into Alibaba Cloud output:\n${leakedFiles.join('\n')}`);
}

console.log('Checked Alibaba Cloud standalone output; secret sentinel was not serialized.');
