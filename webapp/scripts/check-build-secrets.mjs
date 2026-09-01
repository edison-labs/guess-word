import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const sentinel = 'guessword-build-secret-sentinel-7f4a9c2e';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const build = spawnSync(npmCommand, ['run', 'build'], {
  cwd: projectDirectory,
  env: {
    ...process.env,
    APP_ENV: 'production',
    SEMANTIC_PROVIDER: 'cloudflare-ai',
    TEST_QUESTION_ID: '',
    CLOUDFLARE_ACCOUNT_ID: 'sentinel-account',
    CLOUDFLARE_AI_API_TOKEN: sentinel,
    CLOUDFLARE_AI_MODEL: '@cf/baai/bge-m3',
    DEEPSEEK_API_KEY: sentinel,
    DEEPSEEK_MODEL: 'deepseek-v4-flash',
  },
  stdio: 'inherit',
});

if (build.error) throw build.error;
if (build.status !== 0) {
  throw new Error(`Sentinel production build failed with exit code ${build.status}.`);
}

const roots = ['dist', '.cloudflare/output', '.wrangler/deploy']
  .map((path) => join(projectDirectory, path))
  .filter(existsSync);

if (roots.length === 0) {
  throw new Error('No production or deployment build output was found.');
}

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
  throw new Error(
    `Secret sentinel leaked into build output:\n${leakedFiles.join('\n')}`,
  );
}

console.log(
  `Checked ${roots.length} build-output root(s); secret sentinel was not serialized.`,
);
