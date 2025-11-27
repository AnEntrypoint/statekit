#!/usr/bin/env node
const { StateKit } = require('./lib');
const fs = require('fs');

const args = process.argv.slice(2);
const cmd = args[0];

const kit = new StateKit({
  stateDir: process.env.SEQUENTIAL_MACHINE_DIR || '.sequential-machine',
  workdir: process.env.SEQUENTIAL_MACHINE_WORK || undefined
});

async function main() {
  switch (cmd) {
    case 'run': {
      const instruction = args.slice(1).join(' ');
      if (!instruction) return exit('Usage: sequential-machine run <command>');
      const r = await kit.run(instruction);
      const status = r.cached ? 'cached' : r.empty ? 'empty' : 'new';
      console.log(`${r.short} [${status}]`);
      break;
    }

    case 'exec': {
      const instruction = args.slice(1).join(' ');
      if (!instruction) return exit('Usage: sequential-machine exec <command>');
      await kit.exec(instruction);
      break;
    }

    case 'batch': {
      const file = args[1];
      if (!file) return exit('Usage: sequential-machine batch <file.json>');
      const instructions = JSON.parse(fs.readFileSync(file, 'utf8'));
      const results = await kit.batch(instructions);
      for (const r of results) {
        const status = r.cached ? 'cached' : r.empty ? 'empty' : 'new';
        console.log(`${r.short} [${status}]`);
      }
      break;
    }

    case 'history': {
      const history = kit.history();
      if (history.length === 0) return console.log('(empty)');
      for (const l of history) {
        const parent = l.parentShort ? ` <- ${l.parentShort}` : '';
        console.log(`${l.short}${parent}  ${l.instruction}`);
      }
      break;
    }

    case 'status': {
      const s = await kit.status();
      if (s.clean) return console.log('clean');
      for (const f of s.added) console.log(`+ ${f}`);
      for (const f of s.modified) console.log(`~ ${f}`);
      for (const f of s.deleted) console.log(`- ${f}`);
      break;
    }

    case 'diff': {
      const from = args[1];
      const to = args[2];
      const d = await kit.diff(from, to);
      if (d.added.length === 0 && d.modified.length === 0 && d.deleted.length === 0) {
        return console.log('(no changes)');
      }
      for (const f of d.added) console.log(`+ ${f}`);
      for (const f of d.modified) console.log(`~ ${f}`);
      for (const f of d.deleted) console.log(`- ${f}`);
      break;
    }

    case 'checkout': {
      const ref = args[1];
      if (!ref) return exit('Usage: sequential-machine checkout <ref>');
      await kit.checkout(ref);
      console.log(`checked out ${kit.head().slice(0, 12)}`);
      break;
    }

    case 'tag': {
      const name = args[1];
      const ref = args[2];
      if (!name) return exit('Usage: sequential-machine tag <name> [ref]');
      kit.tag(name, ref);
      console.log(`tagged ${name} -> ${kit._resolve(name).slice(0, 12)}`);
      break;
    }

    case 'tags': {
      const tags = kit.tags();
      const entries = Object.entries(tags);
      if (entries.length === 0) return console.log('(no tags)');
      for (const [name, hash] of entries) {
        console.log(`${name} -> ${hash.slice(0, 12)}`);
      }
      break;
    }

    case 'inspect': {
      const ref = args[1];
      if (!ref) return exit('Usage: sequential-machine inspect <ref>');
      const info = kit.inspect(ref);
      console.log(`hash:        ${info.hash}`);
      console.log(`instruction: ${info.instruction}`);
      console.log(`parent:      ${info.parent || '(none)'}`);
      console.log(`time:        ${info.time.toISOString()}`);
      console.log(`size:        ${formatBytes(info.size)}`);
      break;
    }

    case 'rebuild': {
      const count = await kit.rebuild();
      console.log(`rebuilt ${count} layers`);
      break;
    }

    case 'reset': {
      await kit.reset();
      console.log('reset');
      break;
    }

    case 'head': {
      const head = kit.head();
      console.log(head ? head.slice(0, 12) : '(empty)');
      break;
    }

    default:
      console.log(`sequential-machine - persistent compute through content-addressable layers

Commands:
  run <cmd>        Run command and capture state as layer
  exec <cmd>       Run command without capturing state
  batch <file>     Run instructions from JSON array file
  
  history          Show layer history
  status           Show uncommitted changes in workdir
  diff [from] [to] Show changes between layers
  
  checkout <ref>   Restore workdir to a layer
  tag <name> [ref] Create named reference to a layer
  tags             List all tags
  inspect <ref>    Show layer details
  
  rebuild          Rebuild workdir from layers
  reset            Clear all state
  head             Show current head

Refs can be: full hash, short hash (12+ chars), or tag name

Environment:
  SEQUENTIAL_MACHINE_DIR     State directory (default: .sequential-machine)
  SEQUENTIAL_MACHINE_WORK    Working directory (default: .sequential-machine/work)
`);
  }
}

function exit(msg) {
  console.error(msg);
  process.exit(1);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
