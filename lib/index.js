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
      return { hash: cached.hash, short: cached.hash.slice(0, 12), cached: true };
    }

    await this._exec(instruction);
    
    const result = parent 
      ? await this.snapshot.diff(this.workdir, parent)
      : await this.snapshot.capture(this.workdir);

    if (!result) {
      return { hash: parent, short: parent?.slice(0, 12), cached: false, empty: true };
    }

    this.store.put(result.hash, result.buffer);
    this.store.commit(result.hash, instruction, parent);
    
    return { hash: result.hash, short: result.hash.slice(0, 12), cached: false };
  }

  async exec(cmd) {
    await this._exec(cmd);
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

  async checkout(ref) {
    const hash = this._resolve(ref);
    const layers = this.store.ancestry();
    const idx = layers.findIndex(l => l.hash === hash);
    if (idx === -1) throw new Error(`Layer not found: ${ref}`);
    
    const subset = layers.slice(0, idx + 1);
    await this.snapshot.rebuild(this.workdir, subset);
    
    const index = this.store._index();
    index.head = hash;
    this.store._save(index);
  }

  async status() {
    const head = this.store.head();
    const headState = head ? await this.snapshot._stateFromLayer(head) : new Map();
    const workState = await this.snapshot._state(this.workdir);
    
    const added = [];
    const modified = [];
    const deleted = [];
    
    for (const [rel, cur] of workState) {
      const prev = headState.get(rel);
      if (!prev) added.push(rel);
      else if (prev.hash !== cur.hash) modified.push(rel);
    }
    
    for (const [rel] of headState) {
      if (!workState.has(rel)) deleted.push(rel);
    }
    
    return { added, modified, deleted, clean: added.length === 0 && modified.length === 0 && deleted.length === 0 };
  }

  async diff(fromRef, toRef) {
    const fromHash = fromRef ? this._resolve(fromRef) : null;
    const toHash = toRef ? this._resolve(toRef) : this.store.head();
    
    const fromState = fromHash ? await this.snapshot._stateFromLayer(fromHash) : new Map();
    const toState = toHash ? await this.snapshot._stateFromLayer(toHash) : new Map();
    
    const added = [];
    const modified = [];
    const deleted = [];
    
    for (const [rel, cur] of toState) {
      const prev = fromState.get(rel);
      if (!prev) added.push(rel);
      else if (prev.hash !== cur.hash) modified.push(rel);
    }
    
    for (const [rel] of fromState) {
      if (!toState.has(rel)) deleted.push(rel);
    }
    
    return { added, modified, deleted };
  }

  tag(name, hash) {
    const resolved = hash ? this._resolve(hash) : this.store.head();
    if (!resolved) throw new Error('Nothing to tag');
    
    const index = this.store._index();
    index.tags = index.tags || {};
    index.tags[name] = resolved;
    this.store._save(index);
  }

  tags() {
    const index = this.store._index();
    return index.tags || {};
  }

  inspect(ref) {
    const hash = this._resolve(ref);
    const layers = this.store.layers();
    const layer = layers.find(l => l.hash === hash);
    if (!layer) throw new Error(`Layer not found: ${ref}`);
    
    const data = this.store.get(hash);
    return {
      hash: layer.hash,
      short: layer.hash.slice(0, 12),
      instruction: layer.instruction,
      parent: layer.parent,
      parentShort: layer.parent?.slice(0, 12),
      time: new Date(layer.time),
      size: data ? data.length : 0
    };
  }

  history() {
    return this.store.ancestry().map(l => ({
      ...l,
      short: l.hash.slice(0, 12),
      parentShort: l.parent?.slice(0, 12)
    }));
  }

  head() {
    return this.store.head();
  }

  _resolve(ref) {
    if (!ref) return null;
    
    const index = this.store._index();
    if (index.tags && index.tags[ref]) return index.tags[ref];
    
    const layers = index.layers;
    const byShort = layers.find(l => l.hash.startsWith(ref));
    if (byShort) return byShort.hash;
    
    const byFull = layers.find(l => l.hash === ref);
    if (byFull) return byFull.hash;
    
    throw new Error(`Cannot resolve ref: ${ref}`);
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
        else reject(new Error(`Command exited with ${code}: ${cmd}`));
      });
      
      proc.on('error', reject);
    });
  }
}

module.exports = { StateKit, Store, Snapshot };
