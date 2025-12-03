import logger from '@sequential/sequential-logging';
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
      logger.info(`${r.short} [${status}]`);
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
        logger.info(`${r.short} [${status}]`);
      }
      break;
    }

    case 'history': {
      const history = kit.history();
      if (history.length === 0) return logger.info('(empty)');
      for (const l of history) {
        const parent = l.parentShort ? ` <- ${l.parentShort}` : '';
        logger.info(`${l.short}${parent}  ${l.instruction}`);
      }
      break;
    }

    case 'status': {
      const s = await kit.status();
      if (s.clean) return logger.info('clean');
      for (const f of s.added) logger.info(`+ ${f}`);
      for (const f of s.modified) logger.info(`~ ${f}`);
      for (const f of s.deleted) logger.info(`- ${f}`);
      break;
    }

    case 'diff': {
      const from = args[1];
      const to = args[2];
      const d = await kit.diff(from, to);
      if (d.added.length === 0 && d.modified.length === 0 && d.deleted.length === 0) {
        return logger.info('(no changes)');
      }
      for (const f of d.added) logger.info(`+ ${f}`);
      for (const f of d.modified) logger.info(`~ ${f}`);
      for (const f of d.deleted) logger.info(`- ${f}`);
      break;
    }

    case 'checkout': {
      const ref = args[1];
      if (!ref) return exit('Usage: sequential-machine checkout <ref>');
      await kit.checkout(ref);
      logger.info(`checked out ${kit.head().slice(0, 12)}`);
      break;
    }

    case 'tag': {
      const name = args[1];
      const ref = args[2];
      if (!name) return exit('Usage: sequential-machine tag <name> [ref]');
      kit.tag(name, ref);
      logger.info(`tagged ${name} -> ${kit._resolve(name).slice(0, 12)}`);
      break;
    }

    case 'tags': {
      const tags = kit.tags();
      const entries = Object.entries(tags);
      if (entries.length === 0) return logger.info('(no tags)');
      for (const [name, hash] of entries) {
        logger.info(`${name} -> ${hash.slice(0, 12)}`);
      }
      break;
    }

    case 'inspect': {
      const ref = args[1];
      if (!ref) return exit('Usage: sequential-machine inspect <ref>');
      const info = kit.inspect(ref);
      logger.info(`hash:        ${info.hash}`);
      logger.info(`instruction: ${info.instruction}`);
      logger.info(`parent:      ${info.parent || '(none)'}`);
      logger.info(`time:        ${info.time.toISOString()}`);
      logger.info(`size:        ${formatBytes(info.size)}`);
      break;
    }

    case 'rebuild': {
      const count = await kit.rebuild();
      logger.info(`rebuilt ${count} layers`);
      break;
    }

    case 'reset': {
      await kit.reset();
      logger.info('reset');
      break;
    }

    case 'head': {
      const head = kit.head();
      logger.info(head ? head.slice(0, 12) : '(empty)');
      break;
    }

    default:
      logger.info(`sequential-machine - persistent compute through content-addressable layers

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
  logger.error(msg);
  process.exit(1);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

main().catch(err => {
  logger.error(err.message);
  process.exit(1);
});
