#!/usr/bin/env node

const { execSync } = require('child_process')
const {
  findPidOnPort,
  killProcess,
  getPort,
  isPortListening
} = require('./utils.js')

async function run(options) {
  const port = getPort(options)
  
  console.log(`=== Stopping Witty-Skill-Insight Service (Port: ${port}) ===\n`)
  
  const pid = findPidOnPort(port)
  
  if (pid) {
    console.log(`Found service running with PID: ${pid}`)
    
    if (killProcess(pid)) {
      console.log('✓ Service stopped successfully')
    } else {
      console.error(`❌ Failed to stop service (PID: ${pid})`)
      console.error('You may need to manually kill the process:')
      console.error(`  kill -9 ${pid}`)
      process.exit(1)
    }
    return
  }
  
  const isListening = await isPortListening(port)
  if (isListening) {
    console.log(`Service is running on port ${port} but PID not available.`)
    console.log('Trying to stop via pkill...')
    
    try {
      execSync('pkill -f "next dev"', { stdio: 'ignore' })
    } catch (e) {}
    
    try {
      execSync('pkill -f "next start"', { stdio: 'ignore' })
    } catch (e) {}
    
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    const stillListening = await isPortListening(port)
    if (!stillListening) {
      console.log('✓ Service stopped successfully')
      return
    }
    
    console.error('❌ Failed to stop service automatically.')
    console.error('Please stop the service manually:')
    console.error(`  pkill -f "next dev"`)
    console.error(`  pkill -f "next start"`)
    console.error('  or find the process and kill it:')
    console.error(`  ps aux | grep next`)
    process.exit(1)
    return
  }
  
  console.log(`✓ No service running on port ${port}`)
}

module.exports = { run }
