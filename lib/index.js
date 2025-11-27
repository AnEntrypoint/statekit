const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Store } = require('./store');
const { Snapshot } = require('./snapshot');

class StateKit {
  constructor(opts = {}) {
    this.stateDir = path.resolve(opts.stateDir || '.statekit');
    this.workdir = path.resolve(opts.workdir || path.join(this.stateDir, 'work'));
    this.store = new Store(this.stateDir);
    this.snapshot = new Snapshot(this.store);
    fs.mkdirSync(this.workdir, { recursive: true });
  }

  async run(instruction) {
    const parent = this.store.head();
    const cached = this.store.find(instruction, parent);
    
    if (cached) {
      await this.snapshot.restore(this.workdir, cached.hash);
      return { hash: cached.hash, cached: true };
    }

    await this._exec(instruction);
    
    const result = parent 
      ? await this.snapshot.diff(this.workdir, parent)
      : await this.snapshot.capture(this.workdir);

    if (!result) {
      return { hash: parent, cached: false, empty: true };
    }

    this.store.put(result.hash, result.buffer);
    this.store.commit(result.hash, instruction, parent);
    
    return { hash: result.hash, cached: false };
  }

  async batch(instructions) {
    const results = [];
    for (const instruction of instructions) {
      results.push(await this.run(instruction));
    }
    return results;
  }

  async rebuild() {
    const layers = this.store.ancestry();
    await this.snapshot.rebuild(this.workdir, layers);
    return layers.length;
  }

  async reset() {
    fs.rmSync(this.stateDir, { recursive: true, force: true });
    this.store = new Store(this.stateDir);
    this.snapshot = new Snapshot(this.store);
    fs.mkdirSync(this.workdir, { recursive: true });
  }

  async checkout(hash) {
    const layers = this.store.ancestry();
    const idx = layers.findIndex(l => l.hash === hash);
    if (idx === -1) throw new Error(`Layer ${hash} not found in ancestry`);
    
    const subset = layers.slice(0, idx + 1);
    await this.snapshot.rebuild(this.workdir, subset);
    
    const index = this.store._index();
    index.head = hash;
    this.store._save(index);
  }

  history() {
    return this.store.ancestry();
  }

  head() {
    return this.store.head();
  }

  _exec(cmd) {
    return new Promise((resolve, reject) => {
      const proc = spawn('sh', ['-c', cmd], {
        cwd: this.workdir,
        stdio: 'inherit',
        env: { ...process.env, HOME: this.workdir }
      });
      
      proc.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`Command failed with code ${code}: ${cmd}`));
      });
      
      proc.on('error', reject);
    });
  }
}

module.exports = { StateKit, Store, Snapshot };
