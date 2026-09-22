'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const {buildId,gitHead}=require('../lib/build.cjs');
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'cricket-build-'));
const write=(root,rel,text)=>{const f=path.join(root,rel);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,text);};
const SHA1='a'.repeat(40),SHA2='b'.repeat(40),SHA3='c'.repeat(40);
test('a deployment is named by its commit',()=>{
  assert.equal(buildId({env:{VERCEL_GIT_COMMIT_SHA:SHA1}}),SHA1);
  assert.equal(buildId({env:{VERCEL_DEPLOYMENT_ID:'dpl_1'}}),'dpl_1');
});
test('a local server reads the checked-out commit and notices a new one without a restart',()=>{
  const root=tmp();
  write(root,'.git/HEAD','ref: refs/heads/main\n');write(root,'.git/refs/heads/main',SHA1+'\n');
  assert.equal(buildId({root,env:{},now:1000}),SHA1);
  write(root,'.git/refs/heads/main',SHA2+'\n');
  assert.equal(buildId({root,env:{},now:1500}),SHA1,'answers are cached for a second');
  assert.equal(buildId({root,env:{},now:3000}),SHA2,'a commit changes the id');
});
test('packed refs, a detached head and a worktree all resolve',()=>{
  const root=tmp();
  write(root,'.git/HEAD','ref: refs/heads/main\n');write(root,'.git/packed-refs','# pack-refs with: peeled fully-peeled sorted\n'+SHA3+' refs/heads/main\n');
  assert.equal(gitHead(root),SHA3);
  const tree=tmp();write(tree,'.git','gitdir: '+path.join(root,'.git','worktrees','wt')+'\n');
  write(root,'.git/worktrees/wt/HEAD','ref: refs/heads/main\n');write(root,'.git/worktrees/wt/commondir','../..\n');
  assert.equal(gitHead(tree),SHA3);
  write(root,'.git/HEAD',SHA2+'\n');assert.equal(gitHead(root),SHA2);
});
test('without a repository the id is fixed for the life of the process',()=>{
  const root=tmp();const a=buildId({root,env:{},now:1000}),b=buildId({root,env:{},now:5000});
  assert.match(a,/^local-/);assert.equal(a,b);
});
