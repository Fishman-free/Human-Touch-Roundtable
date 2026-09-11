import { access, readdir, readFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const files = [resolve(root, 'README.md'), resolve(root, 'CONTRIBUTING.md')];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (entry.name.endsWith('.md') && relative(root, path).replaceAll('\\', '/') !== 'docs/github-upload.md') files.push(path);
  }
}
await collect(resolve(root, 'docs'));
const failures = [];
for (const file of files) {
  const text = await readFile(file, 'utf8');
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = match[1].trim().replace(/^<|>$/g, '');
    if (/^(?:https?:|mailto:|#)/.test(raw)) continue;
    const target = decodeURIComponent(raw.split('#', 1)[0]);
    if (!target) continue;
    try { await access(resolve(dirname(file), target)); }
    catch { failures.push(`${relative(root, file)} -> ${raw}`); }
  }
}
if (failures.length) {
  for (const failure of failures) console.error(`Broken documentation link: ${failure}`);
  process.exitCode = 1;
} else console.log(`Checked relative links in ${files.length} documentation files.`);
