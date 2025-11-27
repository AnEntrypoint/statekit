# sequential-machine

Persistent compute through content-addressable filesystem layers - Sequential ecosystem machine runner.

Run commands, capture filesystem changes as immutable layers. Same instruction from same state = instant cache hit.

## Install

```bash
npm install @sequential-ecosystem/sequential-machine
```

## CLI

```bash
# Run and capture
sequential-machine run "npm install"
sequential-machine run "npm run build"

# Check status
sequential-machine status        # uncommitted workdir changes
sequential-machine history       # layer history
sequential-machine head          # current layer hash

# Navigate
sequential-machine checkout abc123    # by short hash
sequential-machine checkout v1        # by tag
sequential-machine diff abc123 def456 # compare layers

# Tags
sequential-machine tag v1             # tag current head
sequential-machine tag release abc123 # tag specific layer
sequential-machine tags               # list tags

# Inspect
sequential-machine inspect v1         # layer details

# Manage
sequential-machine rebuild            # reconstruct workdir from layers
sequential-machine reset              # clear all state

# Run without capture
sequential-machine exec "cat file.txt"
```

## API

```javascript
const { StateKit, StateKitVFS, SequentialMachineAdapter } = require('@sequential-ecosystem/sequential-machine');

const kit = new StateKit({
  stateDir: '.statekit',
  workdir: '.statekit/work'
});

// Run and capture
const r = await kit.run('echo "hello" > hello.txt');
// { hash: 'abc...', short: 'abc123def456', cached: false }

// Cache hit when same instruction from same parent
await kit.checkout(r.hash);
const cached = await kit.run('echo "hello" > hello.txt');
// { hash: 'abc...', short: 'abc123def456', cached: true }

// Batch
await kit.batch(['npm install', 'npm build', 'npm test']);

// Status - uncommitted changes
const s = await kit.status();
// { added: [], modified: [], deleted: [], clean: true }

// Diff between layers
const d = await kit.diff('abc123', 'def456');
// { added: ['new.txt'], modified: ['changed.txt'], deleted: [] }

// Tags
kit.tag('v1');
kit.tag('release', 'abc123');
kit.tags(); // { v1: 'abc...', release: 'abc...' }

// Navigate
await kit.checkout('v1');     // by tag
await kit.checkout('abc123'); // by short hash

// Inspect
kit.inspect('v1');
// { hash, short, instruction, parent, time, size }

// History
kit.history();
// [{ hash, short, instruction, parent, parentShort, time }, ...]

// Run without capture
await kit.exec('cat file.txt');

// Manage
await kit.rebuild();  // reconstruct workdir
await kit.reset();    // clear everything
```

## How It Works

1. **Run** - execute command in workdir
2. **Diff** - compare to previous state
3. **Store** - save diff as content-addressed tar
4. **Index** - record layer with `sha256(instruction + parent)`
5. **Cache** - on match, restore from stored tar

Each layer stores only what changed. Layers are immutable. Same instruction from same parent always hits cache.

## Refs

Commands accept refs in multiple formats:
- Full hash: `abc123def456...` (64 chars)
- Short hash: `abc123def456` (12+ chars)
- Tag name: `v1`, `release`

## Sequential Machine Adapter

For integration with the Sequential ecosystem as an alternative to xstate:

```javascript
const { SequentialMachineAdapter } = require('@sequential-ecosystem/sequential-machine');

// Initialize adapter
const machine = new SequentialMachineAdapter({
  stateDir: '.sequential-machine',
  workdir: '.sequential-machine/work'
});

// Initialize machine state
await machine.initialize();

// Execute commands with state capture
const result = await machine.execute('npm install');
// { success: true, layer: 'abc...', short: 'abc123', cached: false, instruction: 'npm install' }

// Get current state
const state = machine.getCurrentState();
// { layer: 'abc...', short: 'abc123' }

// Restore to previous layer
await machine.restore('abc123');

// Batch execution
const results = await machine.batch(['npm install', 'npm run build', 'npm test']);

// Checkpoints
await machine.checkpoint('before-deployment');
const checkpoints = machine.listCheckpoints();
await machine.restoreCheckpoint('before-deployment');

// VFS integration for OS.js
const vfs = machine.getVFSAdapter();
await vfs.readdir('sequential-machine:/');
```

## Environment

- `SEQUENTIAL_MACHINE_DIR` - state directory (default: `.sequential-machine`)
- `SEQUENTIAL_MACHINE_WORK` - working directory (default: `.sequential-machine/work`)

## License

Apache-2.0
