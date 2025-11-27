const { StateKit } = require('./lib');
const fs = require('fs');
const path = require('path');

async function test() {
  const testDir = path.join(__dirname, '.test-statekit');
  
  console.log('=== StateKit Tests ===\n');

  const kit = new StateKit({
    stateDir: testDir,
    workdir: path.join(testDir, 'work')
  });

  await kit.reset();
  console.log('1. Reset state');

  const r1 = await kit.run('echo "hello" > file1.txt');
  console.log(`2. First run: ${r1.hash.slice(0, 12)} cached=${r1.cached}`);

  const r2 = await kit.run('echo "world" > file2.txt');
  console.log(`3. Second run: ${r2.hash.slice(0, 12)} cached=${r2.cached}`);

  const history = kit.history();
  console.log(`4. History: ${history.length} layers`);
  for (const l of history) {
    console.log(`   ${l.hash.slice(0, 12)} ${l.instruction}`);
  }

  const file1 = fs.readFileSync(path.join(kit.workdir, 'file1.txt'), 'utf8').trim();
  const file2 = fs.readFileSync(path.join(kit.workdir, 'file2.txt'), 'utf8').trim();
  console.log(`5. Verify files: file1="${file1}" file2="${file2}"`);

  await kit.rebuild();
  console.log('6. Rebuild from layers');

  const file1After = fs.readFileSync(path.join(kit.workdir, 'file1.txt'), 'utf8').trim();
  const file2After = fs.readFileSync(path.join(kit.workdir, 'file2.txt'), 'utf8').trim();
  console.log(`7. After rebuild: file1="${file1After}" file2="${file2After}"`);

  const r3 = await kit.run('mkdir -p subdir && echo "nested" > subdir/nested.txt');
  console.log(`8. Nested directory: ${r3.hash.slice(0, 12)}`);

  const nested = fs.readFileSync(path.join(kit.workdir, 'subdir/nested.txt'), 'utf8').trim();
  console.log(`9. Nested file: "${nested}"`);

  console.log('\n--- Cache test ---');
  await kit.reset();
  
  const c1 = await kit.run('echo "a" > a.txt');
  console.log(`10. First: ${c1.hash.slice(0, 12)} cached=${c1.cached}`);
  
  const c2 = await kit.run('echo "b" > b.txt');
  console.log(`11. Second: ${c2.hash.slice(0, 12)} cached=${c2.cached}`);

  await kit.checkout(c1.hash);
  console.log(`13. Checkout to first: head=${kit.head().slice(0, 12)}`);
  
  const c3 = await kit.run('echo "b" > b.txt');
  console.log(`14. Replay second: ${c3.hash.slice(0, 12)} cached=${c3.cached}`);
  
  if (!c3.cached) {
    throw new Error('Expected cached=true when replaying from same parent state');
  }
  
  const aExists = fs.existsSync(path.join(kit.workdir, 'a.txt'));
  const bExists = fs.existsSync(path.join(kit.workdir, 'b.txt'));
  console.log(`15. Files after cache hit: a.txt=${aExists} b.txt=${bExists}`)

  fs.rmSync(testDir, { recursive: true, force: true });
  console.log('\n=== All tests passed ===');
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
