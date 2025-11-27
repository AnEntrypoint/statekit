const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class Store {
  constructor(dir) {
    this.dir = path.resolve(dir);
    this.blobDir = path.join(this.dir, 'blobs');
    this.indexPath = path.join(this.dir, 'index.json');
    fs.mkdirSync(this.blobDir, { recursive: true });
  }

  _index() {
    if (!fs.existsSync(this.indexPath)) return { head: null, layers: [] };
    return JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
  }

  _save(index) {
    fs.writeFileSync(this.indexPath, JSON.stringify(index, null, 2));
  }

  sha256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  key(instruction, parent) {
    return this.sha256(JSON.stringify({ instruction, parent }));
  }

  has(hash) {
    return fs.existsSync(path.join(this.blobDir, hash));
  }

  get(hash) {
    const p = path.join(this.blobDir, hash);
    return fs.existsSync(p) ? fs.readFileSync(p) : null;
  }

  put(hash, data) {
    fs.writeFileSync(path.join(this.blobDir, hash), data);
  }

  head() {
    return this._index().head;
  }

  layers() {
    return this._index().layers;
  }

  commit(hash, instruction, parent) {
    const index = this._index();
    index.layers.push({ hash, instruction, parent, time: Date.now() });
    index.head = hash;
    this._save(index);
  }

  find(instruction, parent) {
    const k = this.key(instruction, parent);
    const index = this._index();
    return index.layers.find(l => this.key(l.instruction, l.parent) === k);
  }

  ancestry() {
    const index = this._index();
    const byHash = new Map(index.layers.map(l => [l.hash, l]));
    const result = [];
    let current = index.head;
    while (current) {
      const layer = byHash.get(current);
      if (!layer) break;
      result.unshift(layer);
      current = layer.parent;
    }
    return result;
  }
}

module.exports = { Store };
