import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

// This allowlist defines the recommended first upload, independently of local
// databases, third-party toolkits and planning originals.
const root = resolve(import.meta.dirname, '..');
const roots = ['src', 'tests', 'docs', 'scripts', 'public', '.github', 'README.md',
  'CONTRIBUTING.md', 'SECURITY.md', 'package.json', 'package-lock.json', 'tsconfig.json',
  'next-env.d.ts', 'server.ts', '.env.example', '.gitignore', '.gitattributes', '.editorconfig'];
const suspect = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{50,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-[A-Za-z0-9_-]{32,}\b/,
];
const blocked = /(?:^|\/)(?:node_modules|\.next|data|zhihu)(?:\/|$)|\.(?:db|sqlite3?|pem|key|log|tsbuildinfo)(?:$|-)/i;
let files = 0;
let failed = false;
async function visit(path) {
  if (relative(root, path).replaceAll('\\', '/') === 'docs/github-upload.md') return;
  const info = await stat(path);
  if (info.isDirectory()) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) { console.error(`Symlink requires review: ${relative(root, path)}/${entry.name}`); failed = true; }
      else await visit(resolve(path, entry.name));
    }
    return;
  }
  const name = relative(root, path).replaceAll('\\', '/');
  files++;
  if (blocked.test(name) || /(?:^|\/)\.env(?:\.|$)/.test(name) && name !== '.env.example') {
    console.error(`Excluded runtime or credential file in upload roots: ${name}`); failed = true;
  }
  if (info.size > 5 * 1024 * 1024) {
    console.error(`File exceeds 5 MiB; review before upload: ${name}`); failed = true; return;
  }
  if (/\.(?:png|jpe?g|webp|gif|woff2?|ico)$/i.test(name)) return;
  const text = await readFile(path, 'utf8');
  if (suspect.some(pattern => pattern.test(text))) {
    console.error(`Possible credential in ${name} (value withheld)`); failed = true;
  }
}
for (const name of roots) {
  const path = resolve(root, name);
  try { await stat(path); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  await visit(path);
}
console.log(`Reviewed ${files} files in recommended upload roots. ${failed ? 'Review required.' : 'No blocked files or common credential patterns found.'}`);
console.log('This heuristic check cannot prove absence of secrets. Review git diff --cached before publishing.');
process.exitCode = failed ? 1 : 0;
