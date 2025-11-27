#!/usr/bin/env node
const { StateKit } = require('./lib');

const args = process.argv.slice(2);
const cmd = args[0];

const kit = new StateKit({
  stateDir: process.env.STATEKIT_DIR || '.statekit',
  workdir: process.env.STATEKIT_WORK || undefined
});

async function main() {
  switch (cmd) {
    case 'run':
      const instruction = args.slice(1).join(' ');
      if (!instruction) {
        console.error('Usage: statekit run <command>');
        process.exit(1);
      }
      const result = await kit.run(instruction);
      console.log(JSON.stringify(result));
      break;

    case 'batch':
      const file = args[1];
      if (!file) {
        console.error('Usage: statekit batch <file.json>');
        process.exit(1);
      }
      const instructions = JSON.parse(require('fs').readFileSync(file, 'utf8'));
      const results = await kit.batch(instructions);
      console.log(JSON.stringify(results, null, 2));
      break;

    case 'history':
      const history = kit.history();
      for (const layer of history) {
        console.log(`${layer.hash.slice(0, 12)} ${layer.instruction}`);
      }
      break;

    case 'rebuild':
      const count = await kit.rebuild();
      console.log(`Rebuilt ${count} layers`);
      break;

    case 'reset':
      await kit.reset();
      console.log('Reset complete');
      break;

    case 'head':
      const head = kit.head();
      console.log(head || '(empty)');
      break;

    case 'checkout':
      const targetHash = args[1];
      if (!targetHash) {
        console.error('Usage: statekit checkout <hash>');
        process.exit(1);
      }
      await kit.checkout(targetHash);
      console.log(`Checked out ${targetHash.slice(0, 12)}`);
      break;

    default:
      console.log(`statekit - persistent compute through content-addressable layers

Commands:
  run <cmd>       Execute command, capture state diff as layer
  batch <file>    Run instructions from JSON file
  history         Show layer history  
  checkout <hash> Restore workdir to a specific layer
  rebuild         Rebuild workdir from all layers
  reset           Clear all state
  head            Show current head hash

Environment:
  STATEKIT_DIR    State directory (default: .statekit)
  STATEKIT_WORK   Working directory (default: .statekit/work)
`);
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
