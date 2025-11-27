const { StateKit } = require('./lib');
const { StateKitVFS } = require('./lib/vfs');
const fs = require('fs');
const path = require('path');

class SequentialMachineAdapter {
  constructor(options = {}) {
    this.options = {
      stateDir: '.sequential-machine',
      workdir: '.sequential-machine/work',
      ...options
    };
    
    this.kit = new StateKit({
      stateDir: this.options.stateDir,
      workdir: this.options.workdir
    });
    
    this.vfs = new StateKitVFS(this.kit);
    this.currentLayer = null;
  }

  // Initialize the machine state
  async initialize() {
    await fs.promises.mkdir(this.options.stateDir, { recursive: true });
    await fs.promises.mkdir(this.options.workdir, { recursive: true });
    this.currentLayer = this.kit.head();
    return this.currentLayer;
  }

  // Execute a command and capture state
  async execute(instruction, options = {}) {
    const result = await this.kit.run(instruction);
    
    if (!options.noCommit) {
      this.currentLayer = result.hash;
    }
    
    return {
      success: true,
      layer: result.hash,
      short: result.short,
      cached: result.cached,
      empty: result.empty,
      instruction
    };
  }

  // Execute without capturing state
  async executeRaw(instruction) {
    await this.kit.exec(instruction);
    return {
      success: true,
      instruction,
      captured: false
    };
  }

  // Get current state
  getCurrentState() {
    return {
      layer: this.currentLayer,
      short: this.currentLayer ? this.currentLayer.slice(0, 12) : null
    };
  }

  // Restore to a specific layer
  async restore(layerRef) {
    await this.kit.checkout(layerRef);
    this.currentLayer = this.kit.head();
    return this.getCurrentState();
  }

  // Get history of layers
  getHistory() {
    return this.kit.history().map(layer => ({
      hash: layer.hash,
      short: layer.short,
      instruction: layer.instruction,
      parent: layer.parent,
      parentShort: layer.parentShort,
      time: layer.time,
      isCurrent: layer.hash === this.currentLayer
    }));
  }

  // Get status of working directory
  async getStatus() {
    return await this.kit.status();
  }

  // Compare two layers
  async diff(fromRef, toRef) {
    return await this.kit.diff(fromRef, toRef);
  }

  // Tag a layer
  tag(name, layerRef) {
    this.kit.tag(name, layerRef);
    return this.kit.tags();
  }

  // Get all tags
  getTags() {
    return this.kit.tags();
  }

  // Inspect a layer
  inspect(layerRef) {
    return this.kit.inspect(layerRef);
  }

  // Batch execute multiple instructions
  async batch(instructions, options = {}) {
    const results = [];
    for (const instruction of instructions) {
      const result = await this.execute(instruction, options);
      results.push(result);
    }
    return results;
  }

  // Rebuild working directory from layers
  async rebuild() {
    const count = await this.kit.rebuild();
    this.currentLayer = this.kit.head();
    return { rebuilt: count, currentLayer: this.currentLayer };
  }

  // Reset all state
  async reset() {
    await this.kit.reset();
    this.currentLayer = null;
    return { reset: true };
  }

  // Get VFS adapter for OS.js integration
  getVFSAdapter() {
    return this.vfs;
  }

  // Export state for persistence
  export() {
    return {
      currentLayer: this.currentLayer,
      history: this.getHistory(),
      tags: this.getTags(),
      options: this.options
    };
  }

  // Import state from previous session
  async import(exportedState) {
    if (exportedState.currentLayer) {
      await this.restore(exportedState.currentLayer);
    }
    return this.getCurrentState();
  }

  // Create a checkpoint (tag with timestamp)
  async checkpoint(name = null) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const checkpointName = name || `checkpoint-${timestamp}`;
    return this.tag(checkpointName);
  }

  // List available checkpoints
  listCheckpoints() {
    const tags = this.getTags();
    return Object.entries(tags)
      .filter(([name]) => name.startsWith('checkpoint-'))
      .reduce((acc, [name, hash]) => {
        acc[name] = hash;
        return acc;
      }, {});
  }

  // Restore to a checkpoint
  async restoreCheckpoint(name) {
    const checkpoints = this.listCheckpoints();
    if (!checkpoints[name]) {
      throw new Error(`Checkpoint not found: ${name}`);
    }
    return await this.restore(checkpoints[name]);
  }
}

module.exports = { SequentialMachineAdapter };