'use strict';
const fs = require('node:fs');
const path = require('node:path');
// Names the code that answered a request, so a tab can tell when it is
// running on stale files. Vercel names each deployment by its commit. A local
// server reads the checked-out commit straight out of the repository, so a
// commit changes the answer without a restart. A copy with no repository at
// all gets a per-process id, which still changes when the server restarts.
const ROOT = path.join(__dirname, '..');
const started = 'local-' + Date.now().toString(36);
const cache = new Map();
function gitHead(root) {
  try {
    let dir = path.join(root, '.git');
    // In a worktree `.git` is a file naming the real directory, and the refs
    // live in the common directory that points back to.
    if (fs.statSync(dir).isFile()) dir = path.resolve(root, fs.readFileSync(dir, 'utf8').replace(/^gitdir:/, '').trim());
    let common = dir;
    try { common = path.resolve(dir, fs.readFileSync(path.join(dir, 'commondir'), 'utf8').trim()); } catch {}
    const head = fs.readFileSync(path.join(dir, 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref:')) return head;
    const ref = head.slice(4).trim();
    try { return fs.readFileSync(path.join(common, ref), 'utf8').trim(); } catch {}
    const packed = fs.readFileSync(path.join(common, 'packed-refs'), 'utf8').split('\n').find(l => l.endsWith(' ' + ref));
    return packed ? packed.slice(0, packed.indexOf(' ')) : '';
  } catch { return ''; }
}
function buildId({ root = ROOT, env = process.env, now = Date.now() } = {}) {
  const deployed = env.VERCEL_GIT_COMMIT_SHA || env.VERCEL_DEPLOYMENT_ID || env.VERCEL_URL;
  if (deployed) return String(deployed);
  const hit = cache.get(root);
  if (hit && now - hit.at < 1000) return hit.value;
  const value = gitHead(root) || started;
  cache.set(root, { at: now, value });
  return value;
}
module.exports = { buildId, gitHead };
