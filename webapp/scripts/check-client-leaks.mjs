import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const questionSource = readFileSync(new URL('../lib/server/questions.ts', import.meta.url), 'utf8');
const questions = [...questionSource.matchAll(
  /question\('([^']+)',\s*'([^']+)',\s*'[^']+',\s*'([^']+)',\s*'([^']+)'/g,
)].map((match) => ({
  id: match[1],
  answer: match[2],
  subcategory: match[3],
  hotHint: match[4],
}));
if (questions.length < 30) {
  throw new Error(`Expected at least 30 questions, found ${questions.length}.`);
}
const privateQuestionValues = questions.flatMap((question) => Object.values(question));

const roots = ['dist/client', '.vinext/client', '.vinext/static', '.next/static'].filter(existsSync);
if (roots.length === 0) throw new Error('No public client build directory was found. Run npm run build first.');

const textExtensions = new Set(['.js', '.mjs', '.cjs', '.html', '.css', '.json', '.map', '.txt']);
const leaks = [];

function visit(path) {
  const info = statSync(path);
  if (info.isDirectory()) {
    for (const entry of readdirSync(path)) visit(join(path, entry));
    return;
  }
  if (!textExtensions.has(extname(path))) return;
  const content = readFileSync(path, 'utf8');
  for (const value of privateQuestionValues) {
    if (content.includes(value)) leaks.push(`${value} in ${path}`);
  }
}

for (const root of roots) visit(root);
if (leaks.length > 0) {
  throw new Error(`Answer leakage detected:\n${leaks.slice(0, 20).join('\n')}`);
}
console.log(
  `Checked ${privateQuestionValues.length} private question values across ${roots.join(', ')}; no client leak found.`,
);
