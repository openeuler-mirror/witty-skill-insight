const { execSync, spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const http = require('http')

function findPidOnPort(port) {
  const platform = process.platform
  
  try {
    if (platform === 'win32') {
      const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' })
      const lines = output.trim().split('\n')
      for (const line of lines) {
        const parts = line.trim().split(/\s+/)
        if (parts.length >= 5 && parts[1].includes(`:${port}`)) {
          return parts[parts.length - 1]
        }
      }
    } else {
      if (fs.existsSync('/usr/bin/lsof') || fs.existsSync('/usr/sbin/lsof')) {
        try {
          const pid = execSync(`lsof -t -i:${port} -sTCP:LISTEN`, { encoding: 'utf8' })
          if (pid.trim()) return pid.trim()
        } catch (e) {}
      }
      
      if (fs.existsSync('/bin/ss') || fs.existsSync('/usr/bin/ss')) {
        try {
          const output = execSync(`ss -lptn "sport = :${port}"`, { encoding: 'utf8' })
          const match = output.match(/pid=(\d+)/)
          if (match) return match[1]
        } catch (e) {}
      }
      
      if (fs.existsSync('/bin/netstat') || fs.existsSync('/usr/bin/netstat')) {
        try {
          const output = execSync(`netstat -nlp 2>/dev/null | grep ":${port} "`, { encoding: 'utf8' })
          const match = output.match(/(\d+)\//)
          if (match) return match[1]
        } catch (e) {}
      }
      
      try {
        const output = execSync(`fuser ${port}/tcp 2>/dev/null`, { encoding: 'utf8' })
        if (output.trim()) return output.trim()
      } catch (e) {}
    }
  } catch (e) {}
  
  return null
}

function isPortListening(port) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port: port,
      path: '/',
      method: 'HEAD',
      timeout: 1000
    }, (res) => {
      resolve(true)
    })
    
    req.on('error', () => {
      resolve(false)
    })
    
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    
    req.end()
  })
}

function killProcess(pid) {
  try {
    execSync(`kill -9 ${pid}`, { stdio: 'ignore' })
    return true
  } catch (e) {
    return false
  }
}

function getPort(options) {
  if (options.port) return options.port
  if (process.env.PORT) return parseInt(process.env.PORT)
  
  const envPath = path.join(process.cwd(), '.env')
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8')
    const match = envContent.match(/^PORT=(\d+)$/m)
    if (match) return parseInt(match[1])
  }
  
  return 3000
}

function ensureEnvFile(packageRoot) {
  const root = packageRoot || path.resolve(__dirname, '..')
  const envPath = path.join(root, '.env')
  const envExamplePath = path.join(root, '.env.example')
  
  if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
    console.log('No .env found. Initializing from .env.example...')
    fs.copyFileSync(envExamplePath, envPath)
    console.log('✓ .env file created')
  }
}

function ensureDataDirectory(packageRoot) {
  const root = packageRoot || path.resolve(__dirname, '..')
  const dataPath = path.join(root, 'data')
  if (!fs.existsSync(dataPath)) {
    console.log('Creating data directory...')
    fs.mkdirSync(dataPath, { recursive: true })
    console.log('✓ data directory created')
  }
}

function runCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`Running: ${command}`)
    const [cmd, ...args] = command.split(' ')
    const proc = spawn(cmd, args, {
      stdio: 'inherit',
      shell: true,
      ...options
    })
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Command failed with code ${code}`))
      }
    })
  })
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

module.exports = {
  findPidOnPort,
  killProcess,
  getPort,
  ensureEnvFile,
  ensureDataDirectory,
  runCommand,
  sleep,
  isPortListening
}
