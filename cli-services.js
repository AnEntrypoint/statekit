#!/usr/bin/env node
const { SequentialMachineAdapter } = require('./lib');
const fs = require('fs');
const path = require('path');

class ServiceClient {
  constructor(machine, options = {}) {
    this.machine = machine;
    this.options = {
      servicesRegistry: '.service-registry.json',
      servicesDir: './services',
      basePort: 3100,
      timeout: 30000,
      ...options
    };
    this.services = this.loadServices();
  }

  loadServices() {
    const registryPath = path.resolve(this.options.servicesRegistry);
    
    if (!fs.existsSync(registryPath)) {
      console.warn(`⚠️  Service registry not found at ${registryPath}`);
      console.log('💡 Start wrapped services first: npx sequential-wrapped-services');
      return {};
    }

    try {
      const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
      return registry.services || {};
    } catch (error) {
      console.error(`❌ Failed to load service registry: ${error.message}`);
      return {};
    }
  }

  async callService(serviceName, method, params = {}) {
    const service = this.services[serviceName];
    if (!service) {
      throw new Error(`Service not found: ${serviceName}. Available: ${Object.keys(this.services).join(', ')}`);
    }

    const url = `${service.url}/call`;
    const payload = {
      method,
      params,
      timestamp: new Date().toISOString()
    };

    console.log(`🔧 Calling ${serviceName}.${method}...`);
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.options.timeout)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(`Service error: ${result.error || 'Unknown error'}`);
      }

      console.log(`✅ ${serviceName}.${method} completed`);
      return result;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Service call timeout after ${this.options.timeout}ms`);
      }
      throw error;
    }
  }

  // Call service and write result to file - filesystem change triggers checkpoint
  async callServiceToFile(serviceName, method, params = {}) {
    const serviceResult = await this.callService(serviceName, method, params);
    
    // Write service result to file - this creates a filesystem change
    const resultFile = `${serviceName}-${method}-${Date.now()}.json`;
    const resultPath = path.join(this.machine.options.workdir, resultFile);
    
    const resultData = {
      service: serviceName,
      method,
      params,
      result: serviceResult,
      timestamp: new Date().toISOString(),
      success: true
    };
    
    fs.writeFileSync(resultPath, JSON.stringify(resultData, null, 2));
    console.log(`💾 Service result written to: ${resultFile}`);
    
    return serviceResult;
  }

  // Execute command that calls service and writes to file
  async executeServiceCall(serviceName, method, params = {}) {
    const instruction = `echo 'Calling ${serviceName}.${method}...' && node -e "
const fs = require('fs');
const path = require('path');

async function callService() {
  try {
    const response = await fetch('${this.services[serviceName]?.url}/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: '${method}',
        params: ${JSON.stringify(params)},
        timestamp: new Date().toISOString()
      })
    });
    
    if (!response.ok) {
      throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
    }
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(\`Service error: \${result.error || 'Unknown error'}\`);
    }
    
    // Write result to file - this creates filesystem change
    const resultFile = '${serviceName}-${method}-' + Date.now() + '.json';
    const resultPath = path.join(process.cwd(), resultFile);
    
    fs.writeFileSync(resultPath, JSON.stringify({
      service: '${serviceName}',
      method: '${method}',
      params: ${JSON.stringify(params)},
      result: result,
      timestamp: new Date().toISOString(),
      success: true
    }, null, 2));
    
    console.log('💾 Service result written to: ' + resultFile);
  } catch (error) {
    console.error('❌ Service call failed:', error.message);
    process.exit(1);
  }
}

callService();
"`;
    
    // Execute the instruction - sequential-machine will detect filesystem changes and create checkpoint
    return await this.machine.execute(instruction);
  }

  async batchWithServices(instructions) {
    const results = [];
    
    for (const instruction of instructions) {
      let result;
      
      if (typeof instruction === 'string') {
        // Simple instruction
        result = await this.machine.execute(instruction);
      } else if (instruction.service && instruction.method) {
        // Service call instruction - execute as command that writes file
        result = await this.executeServiceCall(
          instruction.service,
          instruction.method,
          instruction.params
        );
      } else {
        throw new Error(`Invalid instruction format: ${JSON.stringify(instruction)}`);
      }
      
      results.push(result);
    }
    
    return results;
  }

  listServices() {
    console.log('📋 Available Services:');
    console.log('─'.repeat(50));
    
    if (Object.keys(this.services).length === 0) {
      console.log('❌ No services loaded');
      return;
    }

    for (const [name, service] of Object.entries(this.services)) {
      console.log(`${name.padEnd(20)} → ${service.url}`);
    }
    
    console.log('─'.repeat(50));
  }

  async checkServiceHealth(serviceName = null) {
    if (serviceName) {
      const service = this.services[serviceName];
      if (!service) {
        throw new Error(`Service not found: ${serviceName}`);
      }

      try {
        const response = await fetch(`${service.url}/health`, {
          signal: AbortSignal.timeout(5000)
        });
        
        if (response.ok) {
          const health = await response.json();
          console.log(`✅ ${serviceName}: ${health.status || 'OK'}`);
          return health;
        } else {
          console.log(`❌ ${serviceName}: HTTP ${response.status}`);
          return null;
        }
      } catch (error) {
        console.log(`❌ ${serviceName}: ${error.message}`);
        return null;
      }
    } else {
      // Check all services
      console.log('🏥 Checking Service Health:');
      console.log('─'.repeat(40));
      
      const results = {};
      for (const name of Object.keys(this.services)) {
        results[name] = await this.checkServiceHealth(name);
      }
      
      return results;
    }
  }

  listServiceResults() {
    const workdir = this.machine.options.workdir;
    if (!fs.existsSync(workdir)) {
      console.log('📄 No service result files found');
      return;
    }

    const files = fs.readdirSync(workdir).filter(f => 
      f.includes('-') && f.endsWith('.json')
    );
    
    if (files.length === 0) {
      console.log('📄 No service result files found');
      return;
    }

    console.log('📄 Service Result Files:');
    console.log('─'.repeat(40));
    
    for (const file of files.sort()) {
      const filePath = path.join(workdir, file);
      const stat = fs.statSync(filePath);
      const parts = file.replace('.json', '').split('-');
      const serviceName = parts[0];
      const method = parts[1];
      
      console.log(`${file.padEnd(30)} ${serviceName}.${method} (${stat.size} bytes)`);
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  const machine = new SequentialMachineAdapter();
  await machine.initialize();
  
  const client = new ServiceClient(machine);

  switch (cmd) {
    case 'call': {
      const serviceName = args[1];
      const method = args[2];
      const paramsStr = args[3] || '{}';
      
      if (!serviceName || !method) {
        return exit('Usage: sequential-machine call <service> <method> [params-json]');
      }

      let params;
      try {
        params = JSON.parse(paramsStr);
      } catch (error) {
        return exit('Invalid params JSON: ' + error.message);
      }

      await client.executeServiceCall(serviceName, method, params);
      break;
    }

    case 'batch-services': {
      const file = args[1];
      if (!file) return exit('Usage: sequential-machine batch-services <file.json>');
      
      const instructions = JSON.parse(fs.readFileSync(file, 'utf8'));
      const results = await client.batchWithServices(instructions);
      
      for (const result of results) {
        const status = result.cached ? 'cached' : result.empty ? 'empty' : 'new';
        console.log(`${result.short} [${status}]`);
      }
      break;
    }

    case 'services': {
      client.listServices();
      break;
    }

    case 'health': {
      const serviceName = args[1];
      await client.checkServiceHealth(serviceName);
      break;
    }

    case 'results': {
      client.listServiceResults();
      break;
    }

    default:
      console.log(`sequential-machine - persistent compute with wrapped services integration

Service Commands:
  call <service> <method> [params]     Call service (writes result file → checkpoint)
  batch-services <file.json>            Execute batch with service calls
  services                              List available services
  health [service]                       Check service health
  results                               List service result files

Standard Commands:
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

Service Integration:
  Service calls work like any other tool - they write result files to workdir
  Filesystem changes automatically trigger checkpoints in sequential-machine
  Result files: {service}-{method}-{timestamp}.json
  
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

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(`Service error: ${result.error || 'Unknown error'}`);
      }

      console.log(`✅ ${serviceName}.${method} completed`);
      return result;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Service call timeout after ${this.options.timeout}ms`);
      }
      throw error;
    }
  }

  async executeWithCheckpoint(instruction, serviceName = null, method = null, params = {}) {
    // Execute the instruction
    const result = await this.machine.execute(instruction);
    
    // If service call specified, make the HTTP call
    if (serviceName && method) {
      const serviceResult = await this.callService(serviceName, method, params);
      
      // Write service result to file for checkpointing
      const checkpointFile = `service-result-${serviceName}-${method}-${Date.now()}.json`;
      const checkpointPath = path.join(this.machine.options.workdir, checkpointFile);
      
      fs.writeFileSync(checkpointPath, JSON.stringify({
        service: serviceName,
        method,
        params,
        result: serviceResult,
        instruction,
        layer: result.layer,
        timestamp: new Date().toISOString()
      }, null, 2));

      console.log(`💾 Service result saved to: ${checkpointFile}`);

      // Create a checkpoint after service call
      const checkpointName = `after-${serviceName}-${method}`;
      await this.machine.checkpoint(checkpointName);
      console.log(`🏁 Checkpoint created: ${checkpointName}`);

      return {
        ...result,
        serviceResult,
        checkpointFile,
        checkpointName
      };
    }

    return result;
  }

  async batchWithServices(instructions) {
    const results = [];
    
    for (const instruction of instructions) {
      let result;
      
      if (typeof instruction === 'string') {
        // Simple instruction
        result = await this.machine.execute(instruction);
      } else if (instruction.service && instruction.method) {
        // Service call instruction
        result = await this.executeWithCheckpoint(
          instruction.instruction || `service-call-${instruction.service}-${instruction.method}`,
          instruction.service,
          instruction.method,
          instruction.params
        );
      } else {
        throw new Error(`Invalid instruction format: ${JSON.stringify(instruction)}`);
      }
      
      results.push(result);
    }
    
    return results;
  }

  listServices() {
    console.log('📋 Available Services:');
    console.log('─'.repeat(50));
    
    if (Object.keys(this.services).length === 0) {
      console.log('❌ No services loaded');
      return;
    }

    for (const [name, service] of Object.entries(this.services)) {
      console.log(`${name.padEnd(20)} → ${service.url}`);
    }
    
    console.log('─'.repeat(50));
  }

  async checkServiceHealth(serviceName = null) {
    if (serviceName) {
      const service = this.services[serviceName];
      if (!service) {
        throw new Error(`Service not found: ${serviceName}`);
      }

      try {
        const response = await fetch(`${service.url}/health`, {
          signal: AbortSignal.timeout(5000)
        });
        
        if (response.ok) {
          const health = await response.json();
          console.log(`✅ ${serviceName}: ${health.status || 'OK'}`);
          return health;
        } else {
          console.log(`❌ ${serviceName}: HTTP ${response.status}`);
          return null;
        }
      } catch (error) {
        console.log(`❌ ${serviceName}: ${error.message}`);
        return null;
      }
    } else {
      // Check all services
      console.log('🏥 Checking Service Health:');
      console.log('─'.repeat(40));
      
      const results = {};
      for (const name of Object.keys(this.services)) {
        results[name] = await this.checkServiceHealth(name);
      }
      
      return results;
    }
  }

  async restoreFromServiceCheckpoint(checkpointName) {
    const checkpoints = this.machine.listCheckpoints();
    const checkpointHash = checkpoints[checkpointName];
    
    if (!checkpointHash) {
      throw new Error(`Checkpoint not found: ${checkpointName}. Available: ${Object.keys(checkpoints).join(', ')}`);
    }

    await this.machine.restoreCheckpoint(checkpointName);
    console.log(`🔄 Restored to checkpoint: ${checkpointName}`);
    
    // List service result files in current layer
    const workdir = this.machine.options.workdir;
    const files = fs.readdirSync(workdir).filter(f => f.startsWith('service-result-'));
    
    if (files.length > 0) {
      console.log('📄 Service result files in current layer:');
      for (const file of files) {
        console.log(`  - ${file}`);
      }
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  const machine = new SequentialMachineAdapter();
  await machine.initialize();
  
  const client = new ServiceClient(machine);

  switch (cmd) {
    case 'call': {
      const serviceName = args[1];
      const method = args[2];
      const instruction = args[3] || `service-call-${serviceName}-${method}`;
      
      if (!serviceName || !method) {
        return exit('Usage: sequential-machine call <service> <method> [instruction]');
      }

      await client.executeWithCheckpoint(instruction, serviceName, method);
      break;
    }

    case 'batch-services': {
      const file = args[1];
      if (!file) return exit('Usage: sequential-machine batch-services <file.json>');
      
      const instructions = JSON.parse(fs.readFileSync(file, 'utf8'));
      const results = await client.batchWithServices(instructions);
      
      for (const result of results) {
        const status = result.cached ? 'cached' : result.empty ? 'empty' : 'new';
        const serviceInfo = result.serviceResult ? ` [${result.serviceResult.service}.${result.serviceResult.method}]` : '';
        console.log(`${result.short} [${status}]${serviceInfo}`);
      }
      break;
    }

    case 'services': {
      client.listServices();
      break;
    }

    case 'health': {
      const serviceName = args[1];
      await client.checkServiceHealth(serviceName);
      break;
    }

    case 'restore-checkpoint': {
      const checkpointName = args[1];
      if (!checkpointName) return exit('Usage: sequential-machine restore-checkpoint <name>');
      
      await client.restoreFromServiceCheckpoint(checkpointName);
      break;
    }

    default:
      console.log(`sequential-machine - persistent compute with wrapped services integration

Service Commands:
  call <service> <method> [instruction]  Call service and create checkpoint
  batch-services <file.json>            Execute batch with service calls
  services                              List available services
  health [service]                       Check service health
  restore-checkpoint <name>               Restore from service checkpoint

Standard Commands:
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

Service Integration:
  Service calls automatically create checkpoints with format 'after-{service}-{method}'
  Results are saved to workdir as 'service-result-{service}-{method}-{timestamp}.json'
  
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

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});