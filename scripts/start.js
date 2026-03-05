#!/usr/bin/env node

const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const {
  findPidOnPort,
  killProcess,
  getPort,
  ensureEnvFile,
  runCommand,
  sleep
} = require('./utils.js')

let spawnedProc = null

function cleanup() {
  if (spawnedProc) {
    try {
      spawnedProc.kill()
    } catch (e) {}
  }
}

process.on('SIGINT', () => {
  console.log('\nReceived SIGINT, cleaning up...')
  cleanup()
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM, cleaning up...')
  cleanup()
  process.exit(0)
})

async function run(options) {
  const port = getPort(options)
  
  console.log('=== Starting Witty-Skill-Insight Service ===\n')
  
  ensureEnvFile()
  console.log()
  
  const existingPid = findPidOnPort(port)
  if (existingPid) {
    console.log(`⚠️  Port ${port} is already in use by PID: ${existingPid}`)
    console.log('Please stop the existing service first or use a different port.')
    console.log(`\nTo stop: npx witty-skill-insight stop --port ${port}`)
    process.exit(1)
  }
  
  try {
    console.log('Syncing database schema...')
    await runCommand('npx prisma db push')
    console.log('✓ Database schema synced')
    console.log()
    
    console.log('Generating Prisma client...')
    await runCommand('npx prisma generate')
    console.log('✓ Prisma client generated')
    console.log()
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message)
    process.exit(1)
  }
  
  console.log(`Starting server on port ${port}...`)
  
  const logPath = path.join(process.cwd(), 'server.log')
  const env = { ...process.env, PORT: port.toString() }
  
  try {
    spawnedProc = spawn('npm', ['run', 'dev'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      detached: true
    })
    
    spawnedProc.on('error', (error) => {
      console.error('❌ Failed to spawn process:', error.message)
      process.exit(1)
    })
  } catch (error) {
    console.error('❌ Failed to spawn process:', error.message)
    process.exit(1)
  }
  
  try {
    const logStream = fs.createWriteStream(logPath, { flags: 'a' })
    if (spawnedProc.stdout) {
      spawnedProc.stdout.pipe(logStream)
    }
    if (spawnedProc.stderr) {
      spawnedProc.stderr.pipe(logStream)
    }
  } catch (error) {
    console.error('⚠️  Warning: Could not create log stream:', error.message)
  }
  
  spawnedProc.unref()
  
  const maxRetries = 10
  const retryDelay = 500
  
  for (let i = 0; i < maxRetries; i++) {
    await sleep(retryDelay)
    const pid = findPidOnPort(port)
    if (pid) {
      console.log('✓ Server started successfully')
      console.log(`  PID: ${pid}`)
      console.log(`  Port: ${port}`)
      console.log(`  Log: ${logPath}`)
      console.log(`  URL: http://localhost:${port}`)
      return
    }
  }
  
  console.error('❌ Failed to start server. Check server.log for details.')
  process.exit(1)
}

module.exports = { run }
