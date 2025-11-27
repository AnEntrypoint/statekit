const { StateKit } = require('./lib');
const fs = require('fs');
const path = require('path');

const testDir = path.join(__dirname, '.test-statekit');
let kit;
let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.log(`  ✗ ${msg}`);
    failed++;
  }
}

async function setup() {
  kit = new StateKit({ stateDir: testDir, workdir: path.join(testDir, 'work') });
  await kit.reset();
}

async function testBasicRun() {
  console.log('\n=== Basic Run ===');
  await setup();
  
  const r = await kit.run('echo "hello" > file.txt');
  assert(r.hash && r.hash.length === 64, 'returns sha256 hash');
  assert(r.cached === false, 'not cached on first run');
  assert(fs.existsSync(path.join(kit.workdir, 'file.txt')), 'file created');
  assert(fs.readFileSync(path.join(kit.workdir, 'file.txt'), 'utf8').trim() === 'hello', 'file content correct');
}

async function testCaching() {
  console.log('\n=== Caching ===');
  await setup();
  
  const r1 = await kit.run('echo "a" > a.txt');
  const h1 = kit.head();
  
  await kit.checkout(h1);
  const r2 = await kit.run('echo "b" > b.txt');
  assert(r2.cached === false, 'different instruction not cached');
  
  await kit.checkout(h1);
  const r3 = await kit.run('echo "b" > b.txt');
  assert(r3.cached === true, 'same instruction from same parent cached');
  assert(r3.hash === r2.hash, 'cached hash matches original');
}

async function testHistory() {
  console.log('\n=== History ===');
  await setup();
  
  await kit.run('echo "1" > one.txt');
  await kit.run('echo "2" > two.txt');
  await kit.run('echo "3" > three.txt');
  
  const history = kit.history();
  assert(history.length === 3, 'history has 3 layers');
  assert(history[0].instruction === 'echo "1" > one.txt', 'first instruction correct');
  assert(history[1].parent === history[0].hash, 'parent chain correct');
  assert(history[2].parent === history[1].hash, 'parent chain correct');
}

async function testCheckout() {
  console.log('\n=== Checkout ===');
  await setup();
  
  const r1 = await kit.run('echo "1" > one.txt');
  const r2 = await kit.run('echo "2" > two.txt');
  
  assert(fs.existsSync(path.join(kit.workdir, 'two.txt')), 'two.txt exists before checkout');
  
  await kit.checkout(r1.hash);
  assert(kit.head() === r1.hash, 'head updated after checkout');
  assert(fs.existsSync(path.join(kit.workdir, 'one.txt')), 'one.txt exists after checkout');
  assert(!fs.existsSync(path.join(kit.workdir, 'two.txt')), 'two.txt removed after checkout');
}

async function testRebuild() {
  console.log('\n=== Rebuild ===');
  await setup();
  
  await kit.run('echo "1" > one.txt');
  await kit.run('mkdir -p sub && echo "2" > sub/two.txt');
  
  fs.rmSync(kit.workdir, { recursive: true, force: true });
  assert(!fs.existsSync(kit.workdir), 'workdir deleted');
  
  const count = await kit.rebuild();
  assert(count === 2, 'rebuilt 2 layers');
  assert(fs.existsSync(path.join(kit.workdir, 'one.txt')), 'one.txt restored');
  assert(fs.existsSync(path.join(kit.workdir, 'sub/two.txt')), 'sub/two.txt restored');
}

async function testReset() {
  console.log('\n=== Reset ===');
  await setup();
  
  await kit.run('echo "test" > test.txt');
  assert(kit.history().length === 1, 'has history before reset');
  
  await kit.reset();
  assert(kit.history().length === 0, 'history cleared after reset');
  assert(kit.head() === null, 'head is null after reset');
  assert(fs.readdirSync(kit.workdir).length === 0, 'workdir empty after reset');
}

async function testBatch() {
  console.log('\n=== Batch ===');
  await setup();
  
  const results = await kit.batch([
    'echo "a" > a.txt',
    'echo "b" > b.txt',
    'echo "c" > c.txt'
  ]);
  
  assert(results.length === 3, 'batch returns 3 results');
  assert(results.every(r => !r.cached), 'none cached on first run');
  assert(kit.history().length === 3, 'history has 3 layers');
}

async function testNestedDirectories() {
  console.log('\n=== Nested Directories ===');
  await setup();
  
  await kit.run('mkdir -p a/b/c && echo "deep" > a/b/c/file.txt');
  
  const content = fs.readFileSync(path.join(kit.workdir, 'a/b/c/file.txt'), 'utf8').trim();
  assert(content === 'deep', 'nested file created');
  
  await kit.rebuild();
  const restored = fs.readFileSync(path.join(kit.workdir, 'a/b/c/file.txt'), 'utf8').trim();
  assert(restored === 'deep', 'nested file restored after rebuild');
}

async function testFileModification() {
  console.log('\n=== File Modification ===');
  await setup();
  
  await kit.run('echo "v1" > file.txt');
  const h1 = kit.head();
  
  await kit.run('echo "v2" > file.txt');
  const h2 = kit.head();
  
  assert(h1 !== h2, 'modification creates new hash');
  
  await kit.checkout(h1);
  assert(fs.readFileSync(path.join(kit.workdir, 'file.txt'), 'utf8').trim() === 'v1', 'checkout restores v1');
}

async function testFileDeletion() {
  console.log('\n=== File Deletion ===');
  await setup();
  
  await kit.run('echo "a" > a.txt && echo "b" > b.txt');
  await kit.run('rm a.txt');
  
  assert(!fs.existsSync(path.join(kit.workdir, 'a.txt')), 'a.txt deleted');
  assert(fs.existsSync(path.join(kit.workdir, 'b.txt')), 'b.txt still exists');
}

async function testEmptyRun() {
  console.log('\n=== Empty Run (no changes) ===');
  await setup();
  
  await kit.run('echo "test" > test.txt');
  const h1 = kit.head();
  
  const r = await kit.run('echo "do nothing"');
  assert(r.empty === true || r.hash === h1, 'empty run detected or same hash');
}

async function testCommandFailure() {
  console.log('\n=== Command Failure ===');
  await setup();
  
  let threw = false;
  try {
    await kit.run('exit 1');
  } catch (e) {
    threw = true;
    assert(e.message.includes('exited'), 'error message mentions exit');
  }
  assert(threw, 'failed command throws');
}

async function testBinaryFiles() {
  console.log('\n=== Binary Files ===');
  await setup();
  
  await kit.run('head -c 1024 /dev/urandom > binary.bin');
  const original = fs.readFileSync(path.join(kit.workdir, 'binary.bin'));
  
  await kit.rebuild();
  const restored = fs.readFileSync(path.join(kit.workdir, 'binary.bin'));
  
  assert(Buffer.compare(original, restored) === 0, 'binary file preserved');
}

async function testSymlinks() {
  console.log('\n=== Symlinks ===');
  await setup();
  
  await kit.run('echo "target" > target.txt && ln -s target.txt link.txt');
  
  const stat = fs.lstatSync(path.join(kit.workdir, 'link.txt'));
  assert(stat.isSymbolicLink(), 'symlink created');
  
  const linkTarget = fs.readlinkSync(path.join(kit.workdir, 'link.txt'));
  assert(linkTarget === 'target.txt', 'symlink points to correct target');
}

async function testPermissions() {
  console.log('\n=== Permissions ===');
  await setup();
  
  await kit.run('echo "#!/bin/sh" > script.sh && chmod +x script.sh');
  
  const stat = fs.statSync(path.join(kit.workdir, 'script.sh'));
  assert((stat.mode & 0o111) !== 0, 'executable permission set');
  
  await kit.rebuild();
  const restored = fs.statSync(path.join(kit.workdir, 'script.sh'));
  assert((restored.mode & 0o111) !== 0, 'executable permission preserved after rebuild');
}

async function testLargeFiles() {
  console.log('\n=== Large Files ===');
  await setup();
  
  await kit.run('dd if=/dev/zero of=large.bin bs=1M count=10 2>/dev/null');
  const size = fs.statSync(path.join(kit.workdir, 'large.bin')).size;
  assert(size === 10 * 1024 * 1024, '10MB file created');
  
  await kit.rebuild();
  const restored = fs.statSync(path.join(kit.workdir, 'large.bin')).size;
  assert(restored === 10 * 1024 * 1024, '10MB file restored');
}

async function testManyFiles() {
  console.log('\n=== Many Files ===');
  await setup();
  
  await kit.run('i=1; while [ $i -le 100 ]; do echo $i > file_$i.txt; i=$((i+1)); done');
  
  const files = fs.readdirSync(kit.workdir).filter(f => f.startsWith('file_'));
  assert(files.length === 100, '100 files created');
  
  await kit.rebuild();
  const restored = fs.readdirSync(kit.workdir).filter(f => f.startsWith('file_'));
  assert(restored.length === 100, '100 files restored');
}

async function testConcurrentInstances() {
  console.log('\n=== Concurrent Instances ===');
  await setup();
  
  await kit.run('echo "shared" > shared.txt');
  
  const kit2 = new StateKit({ stateDir: testDir, workdir: path.join(testDir, 'work') });
  
  assert(kit2.head() === kit.head(), 'second instance sees same head');
  assert(kit2.history().length === kit.history().length, 'second instance sees same history');
}

async function testSpecialCharacters() {
  console.log('\n=== Special Characters in Filenames ===');
  await setup();
  
  await kit.run('echo "test" > "file with spaces.txt"');
  assert(fs.existsSync(path.join(kit.workdir, 'file with spaces.txt')), 'file with spaces created');
  
  await kit.run('echo "test" > "file-with-dashes.txt"');
  assert(fs.existsSync(path.join(kit.workdir, 'file-with-dashes.txt')), 'file with dashes created');
}

async function testCheckoutInvalidHash() {
  console.log('\n=== Checkout Invalid Hash ===');
  await setup();
  
  await kit.run('echo "test" > test.txt');
  
  let threw = false;
  try {
    await kit.checkout('invalidhash123');
  } catch (e) {
    threw = true;
    assert(e.message.includes('resolve'), 'error mentions cannot resolve');
  }
  assert(threw, 'checkout invalid hash throws');
}

async function testHeadAfterOperations() {
  console.log('\n=== Head Consistency ===');
  await setup();
  
  assert(kit.head() === null, 'head null initially');
  
  const r1 = await kit.run('echo "1" > one.txt');
  assert(kit.head() === r1.hash, 'head matches after run');
  
  const r2 = await kit.run('echo "2" > two.txt');
  assert(kit.head() === r2.hash, 'head updates after second run');
  
  await kit.checkout(r1.hash);
  assert(kit.head() === r1.hash, 'head matches after checkout');
}

async function testShortHash() {
  console.log('\n=== Short Hash ===');
  await setup();
  
  const r = await kit.run('echo "test" > test.txt');
  assert(r.short && r.short.length === 12, 'short hash is 12 chars');
  assert(r.hash.startsWith(r.short), 'short is prefix of full hash');
  
  const history = kit.history();
  assert(history[0].short.length === 12, 'history includes short hash');
}

async function testStatus() {
  console.log('\n=== Status ===');
  await setup();
  
  await kit.run('echo "a" > a.txt');
  
  let s = await kit.status();
  assert(s.clean === true, 'clean after run');
  assert(s.added.length === 0, 'no added files');
  
  fs.writeFileSync(path.join(kit.workdir, 'b.txt'), 'new');
  s = await kit.status();
  assert(s.added.includes('b.txt'), 'detects added file');
  
  fs.writeFileSync(path.join(kit.workdir, 'a.txt'), 'modified');
  s = await kit.status();
  assert(s.modified.includes('a.txt'), 'detects modified file');
  
  fs.unlinkSync(path.join(kit.workdir, 'a.txt'));
  s = await kit.status();
  assert(s.deleted.includes('a.txt'), 'detects deleted file');
}

async function testDiff() {
  console.log('\n=== Diff ===');
  await setup();
  
  const r1 = await kit.run('echo "a" > a.txt');
  const r2 = await kit.run('echo "b" > b.txt');
  
  const d = await kit.diff(r1.hash, r2.hash);
  assert(d.added.includes('b.txt'), 'diff shows added file');
  assert(!d.modified.includes('a.txt'), 'a.txt not modified');
  
  const r3 = await kit.run('echo "modified" > a.txt');
  const d2 = await kit.diff(r2.hash, r3.hash);
  assert(d2.modified.includes('a.txt'), 'diff shows modified file');
}

async function testTags() {
  console.log('\n=== Tags ===');
  await setup();
  
  const r1 = await kit.run('echo "v1" > file.txt');
  kit.tag('v1');
  
  const r2 = await kit.run('echo "v2" > file.txt');
  kit.tag('v2');
  
  const tags = kit.tags();
  assert(tags['v1'] === r1.hash, 'v1 tag points to r1');
  assert(tags['v2'] === r2.hash, 'v2 tag points to r2');
  
  await kit.checkout('v1');
  assert(kit.head() === r1.hash, 'checkout by tag works');
  
  const content = fs.readFileSync(path.join(kit.workdir, 'file.txt'), 'utf8').trim();
  assert(content === 'v1', 'content restored from tag');
}

async function testExec() {
  console.log('\n=== Exec (no capture) ===');
  await setup();
  
  await kit.run('echo "base" > base.txt');
  const headBefore = kit.head();
  
  await kit.exec('echo "query output"');
  assert(kit.head() === headBefore, 'exec does not change head');
  assert(kit.history().length === 1, 'exec does not create layer');
}

async function testInspect() {
  console.log('\n=== Inspect ===');
  await setup();
  
  const r = await kit.run('echo "test" > test.txt');
  const info = kit.inspect(r.short);
  
  assert(info.hash === r.hash, 'inspect returns full hash');
  assert(info.instruction === 'echo "test" > test.txt', 'inspect shows instruction');
  assert(info.parent === null, 'first layer has no parent');
  assert(info.time instanceof Date, 'inspect includes timestamp');
  assert(info.size > 0, 'inspect includes size');
}

async function testShortHashCheckout() {
  console.log('\n=== Short Hash Checkout ===');
  await setup();
  
  const r1 = await kit.run('echo "1" > one.txt');
  await kit.run('echo "2" > two.txt');
  
  await kit.checkout(r1.short);
  assert(kit.head() === r1.hash, 'checkout by short hash works');
}

async function runAll() {
  console.log('=== StateKit Exhaustive Tests ===');
  
  await testBasicRun();
  await testCaching();
  await testHistory();
  await testCheckout();
  await testRebuild();
  await testReset();
  await testBatch();
  await testNestedDirectories();
  await testFileModification();
  await testFileDeletion();
  await testEmptyRun();
  await testCommandFailure();
  await testBinaryFiles();
  await testSymlinks();
  await testPermissions();
  await testLargeFiles();
  await testManyFiles();
  await testConcurrentInstances();
  await testSpecialCharacters();
  await testCheckoutInvalidHash();
  await testHeadAfterOperations();
  await testShortHash();
  await testStatus();
  await testDiff();
  await testTags();
  await testExec();
  await testInspect();
  await testShortHashCheckout();
  
  fs.rmSync(testDir, { recursive: true, force: true });
  
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runAll().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
