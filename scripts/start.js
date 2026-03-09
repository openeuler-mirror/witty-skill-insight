#!/usr/bin/env node

const { spawn, execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const {
  findPidOnPort,
  killProcess,
  getPort,
  ensureEnvFile,
  ensureDataDirectory,
  runCommand,
  sleep
} = require('./utils.js')

const PACKAGE_ROOT = path.resolve(__dirname, '..')

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return {}
  
  const content = fs.readFileSync(envPath, 'utf8')
  const env = {}
  
  content.split('\n').forEach(line => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    
    const match = trimmed.match(/^([^=]+)=(.*)$/)
    if (match) {
      const key = match[1].trim()
      let value = match[2].trim()
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      env[key] = value
    }
  })
  
  return env
}

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
  
  ensureEnvFile(PACKAGE_ROOT)
  ensureDataDirectory(PACKAGE_ROOT)
  console.log()
  
  const existingPid = findPidOnPort(port)
  if (existingPid) {
    console.log(`⚠️  Port ${port} is already in use by PID: ${existingPid}`)
    console.log('Please stop the existing service first or use a different port.')
    console.log(`\nTo stop: npx witty-skill-insight stop --port ${port}`)
    process.exit(1)
  }
  
  const dbPath = path.join(PACKAGE_ROOT, 'data', 'witty_insight.db')
  process.env.DATABASE_URL = `file:${dbPath}`
  
  const envPath = path.join(PACKAGE_ROOT, '.env')
  const fileEnv = loadEnvFile(envPath)
  
  if (fileEnv.DB_HOST) {
    console.log('OpenGauss configuration detected (DB_HOST=' + fileEnv.DB_HOST + ')')
    console.log('Initializing OpenGauss database with project schema...')
    
    try {
      execSync('python3 -c "import psycopg2"', { stdio: 'pipe' })
    } catch (e) {
      console.log('psycopg2 not found. Installing psycopg2-binary...')
      try {
        execSync('pip3 install psycopg2-binary', { stdio: 'inherit' })
      } catch (pipError) {
        console.log('Warning: Could not install psycopg2-binary. OpenGauss init may fail.')
      }
    }
    
    const initScript = path.join(PACKAGE_ROOT, 'scripts', 'init_opengauss.py')
    if (fs.existsSync(initScript)) {
      try {
        const initEnv = { ...process.env, ...fileEnv }
        execSync('python3 "' + initScript + '"', { 
          stdio: 'inherit', 
          cwd: PACKAGE_ROOT,
          env: initEnv
        })
        console.log('✓ OpenGauss initialized successfully')
      } catch (initError) {
        console.error('Warning: OpenGauss initialization failed:', initError.message)
        console.error('You may need to run it manually: python3 scripts/init_opengauss.py')
      }
    } else {
      console.log('Warning: init_opengauss.py not found, skipping OpenGauss init')
    }
    console.log()
  }
  
  try {
    console.log('Syncing database schema...')
    await runCommand('npx prisma db push', { cwd: PACKAGE_ROOT })
    console.log('✓ Database schema synced')
    console.log()
    
    console.log('Generating Prisma client...')
    await runCommand('npx prisma generate', { cwd: PACKAGE_ROOT })
    console.log('✓ Prisma client generated')
    console.log()
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message)
    process.exit(1)
  }
  
  const standaloneServer = path.join(PACKAGE_ROOT, '.next', 'standalone', 'server.js')
  const isStandalone = fs.existsSync(standaloneServer)
  const nextDir = path.join(PACKAGE_ROOT, '.next')
  const isProduction = fs.existsSync(nextDir) && fs.existsSync(path.join(nextDir, 'BUILD_ID'))
  
  console.log(`Starting server on port ${port}...`)
  
  const logPath = path.join(PACKAGE_ROOT, 'server.log')
  const env = { 
    ...process.env, 
    ...fileEnv, 
    DATABASE_URL: `file:${dbPath}`,
    PORT: port.toString(),
    HOSTNAME: '0.0.0.0'
  }
  
  let command, args
  
  if (isStandalone) {
    console.log('Mode: production (standalone)')
    command = 'node'
    args = [standaloneServer]
  } else if (isProduction) {
    console.log('Mode: production')
    command = 'npm'
    args = ['run', 'start']
  } else {
    console.log('Mode: development')
    command = 'npm'
    args = ['run', 'dev']
  }
  
  try {
    const logFd = fs.openSync(logPath, 'a')
    
    spawnedProc = spawn(command, args, {
      stdio: ['ignore', logFd, logFd],
      env,
      detached: true,
      cwd: PACKAGE_ROOT
    })
    
    spawnedProc.on('error', (error) => {
      console.error('❌ Failed to spawn process:', error.message)
      process.exit(1)
    })
    
    spawnedProc.unref()
  } catch (error) {
    console.error('❌ Failed to spawn process:', error.message)
    process.exit(1)
  }
  
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
