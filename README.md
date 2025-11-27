# statekit

Persistent compute through content-addressable filesystem layers.

Run commands and capture filesystem changes as immutable layers. Skip execution when the same instruction runs from the same state - the result is restored from cache.

## Install

```bash
npm install @anentrypoint/statekit
```

## CLI Usage

```bash
# Run commands and capture state
statekit run "npm install"
statekit run "npm run build"

# View layer history
statekit history

# Go back to a previous state
statekit checkout abc123

# Rebuild workdir from layers
statekit rebuild

# Clear everything
statekit reset
```

## API Usage

```javascript
const { StateKit } = require('@anentrypoint/statekit');

const kit = new StateKit({
  stateDir: '.statekit',
  workdir: '.statekit/work'
});

// Run instruction - captures filesystem diff as layer
const result = await kit.run('echo "hello" > greeting.txt');
// { hash: 'abc123...', cached: false }

// Same instruction from same state = cache hit
await kit.checkout(previousHash);
const cached = await kit.run('echo "hello" > greeting.txt');
// { hash: 'abc123...', cached: true }

// Run multiple instructions
await kit.batch([
  'npm install',
  'npm run build',
  'npm test'
]);

// View history
kit.history();
// [{ hash, instruction, parent, time }, ...]

// Restore to specific layer
await kit.checkout(hash);

// Rebuild from all layers
await kit.rebuild();

// Clear state
await kit.reset();
```

## How It Works

1. **Run** - Execute command in workdir
2. **Diff** - Compare filesystem to previous state
3. **Store** - Save diff as content-addressed tar blob
4. **Cache** - Key = sha256(instruction + parent_hash)
5. **Restore** - On cache hit, extract stored blob

Layers are immutable. The same instruction from the same parent state always produces the same result.

## Environment Variables

- `STATEKIT_DIR` - State directory (default: `.statekit`)
- `STATEKIT_WORK` - Working directory (default: `.statekit/work`)

## License

Apache-2.0
