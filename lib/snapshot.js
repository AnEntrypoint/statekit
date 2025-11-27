const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const tar = require('tar');

class Snapshot {
  constructor(store) {
    this.store = store;
  }

  async capture(workdir) {
    const files = this._walk(workdir);
    if (files.length === 0) return null;
    
    const buffer = await this._pack(workdir, files.map(f => path.relative(workdir, f)));
    const hash = this._hash(buffer);
    return { hash, buffer, files: files.length };
  }

  async diff(workdir, baseHash) {
    const current = await this._state(workdir);
    const base = baseHash ? await this._stateFromLayer(baseHash) : new Map();
    
    const changed = [];
    const deleted = [];

    for (const [rel, cur] of current) {
      const prev = base.get(rel);
      if (!prev || prev.hash !== cur.hash) changed.push(rel);
    }

    for (const [rel] of base) {
      if (!current.has(rel)) deleted.push(rel);
    }

    if (changed.length === 0 && deleted.length === 0) return null;

    const buffer = changed.length > 0 
      ? await this._pack(workdir, changed)
      : Buffer.alloc(0);
    
    const hash = this._hash(Buffer.concat([
      buffer,
      Buffer.from(JSON.stringify(deleted))
    ]));

    return { hash, buffer, changed, deleted };
  }

  async restore(workdir, hash) {
    const data = this.store.get(hash);
    if (!data || data.length === 0) return;
    
    const tmp = path.join(this.store.dir, `.tmp-${Date.now()}.tar`);
    fs.writeFileSync(tmp, data);
    
    try {
      await tar.extract({ file: tmp, cwd: workdir, strict: true });
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
  }

  async rebuild(workdir, layers) {
    fs.rmSync(workdir, { recursive: true, force: true });
    fs.mkdirSync(workdir, { recursive: true });
    for (const layer of layers) {
      await this.restore(workdir, layer.hash);
    }
  }

  _walk(dir) {
    if (!fs.existsSync(dir)) return [];
    const results = [];
    const stack = [dir];
    
    while (stack.length > 0) {
      const current = stack.pop();
      const entries = fs.readdirSync(current, { withFileTypes: true });
      
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        results.push(full);
        if (entry.isDirectory()) stack.push(full);
      }
    }
    
    return results.sort();
  }

  _hash(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  async _pack(cwd, files) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      const stream = tar.create({ gzip: false, portable: true, cwd }, files);
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  async _state(workdir) {
    const state = new Map();
    const files = this._walk(workdir);
    
    for (const file of files) {
      const rel = path.relative(workdir, file);
      const stat = fs.lstatSync(file);
      let hash;
      
      if (stat.isFile()) {
        hash = this._hash(fs.readFileSync(file));
      } else if (stat.isDirectory()) {
        hash = 'dir';
      } else if (stat.isSymbolicLink()) {
        hash = 'link:' + fs.readlinkSync(file);
      }
      
      state.set(rel, { hash, mode: stat.mode });
    }
    
    return state;
  }

  async _stateFromLayer(hash) {
    const state = new Map();
    const data = this.store.get(hash);
    if (!data || data.length === 0) return state;

    const tmp = path.join(this.store.dir, `.tmp-extract-${Date.now()}`);
    const tarPath = path.join(this.store.dir, `.tmp-${Date.now()}.tar`);
    
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(tarPath, data);

    try {
      await tar.extract({ file: tarPath, cwd: tmp });
      const files = this._walk(tmp);
      
      for (const file of files) {
        const rel = path.relative(tmp, file);
        const stat = fs.lstatSync(file);
        let hash;
        
        if (stat.isFile()) {
          hash = this._hash(fs.readFileSync(file));
        } else if (stat.isDirectory()) {
          hash = 'dir';
        } else if (stat.isSymbolicLink()) {
          hash = 'link:' + fs.readlinkSync(file);
        }
        
        state.set(rel, { hash, mode: stat.mode });
      }
    } finally {
      if (fs.existsSync(tarPath)) fs.unlinkSync(tarPath);
      if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
    }

    return state;
  }
}

module.exports = { Snapshot };
