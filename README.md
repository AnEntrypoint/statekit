# statekit

Persistent compute through content-addressable filesystem layers.

Run commands, capture filesystem changes as immutable layers. Same instruction from same state = instant cache hit.

## Install

```bash
npm install @anentrypoint/statekit
```

## CLI

```bash
# Run and capture
statekit run "npm install"
statekit run "npm run build"

# Check status
statekit status        # uncommitted workdir changes
statekit history       # layer history
statekit head          # current layer hash

# Navigate
statekit checkout abc123    # by short hash
statekit checkout v1        # by tag
statekit diff abc123 def456 # compare layers

# Tags
statekit tag v1             # tag current head
statekit tag release abc123 # tag specific layer
statekit tags               # list tags

# Inspect
statekit inspect v1         # layer details

# Manage
statekit rebuild            # reconstruct workdir from layers
statekit reset              # clear all state

# Run without capture
statekit exec "cat file.txt"
```

## API

```javascript
const { StateKit } = require('@anentrypoint/statekit');

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

## Environment

- `STATEKIT_DIR` - state directory (default: `.statekit`)
- `STATEKIT_WORK` - working directory (default: `.statekit/work`)

## License

Apache-2.0
