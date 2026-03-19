#!/usr/bin/env node

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const {
  ensureEnvFile,
  ensureDataDirectory,
  runCommand
} = require('./utils.js')

const PACKAGE_ROOT = path.resolve(__dirname, '..')

console.log('=== Witty-Skill-Insight Post-Install Initialization ===\n')

try {
  ensureEnvFile(PACKAGE_ROOT)
  console.log()
  
  ensureDataDirectory(PACKAGE_ROOT)
  console.log()
  
  console.log('Syncing database schema...')
  execSync('npx prisma db push', { stdio: 'inherit', cwd: PACKAGE_ROOT })
  console.log('✓ Database schema synced')
  console.log()
  
  console.log('Generating Prisma client...')
  execSync('npx prisma generate', { stdio: 'inherit', cwd: PACKAGE_ROOT })
  console.log('✓ Prisma client generated')
  console.log()
  
  const standaloneDir = path.join(PACKAGE_ROOT, '.next', 'standalone')
  if (fs.existsSync(standaloneDir)) {
    console.log('Setting up standalone environment...')
    
    const staticDir = path.join(PACKAGE_ROOT, '.next', 'static')
    const standaloneStaticDir = path.join(standaloneDir, '.next', 'static')
    
    if (fs.existsSync(staticDir) && !fs.existsSync(standaloneStaticDir)) {
      fs.mkdirSync(path.dirname(standaloneStaticDir), { recursive: true })
      execSync(`cp -r "${staticDir}" "${path.dirname(standaloneStaticDir)}/"`, { stdio: 'inherit' })
      console.log('✓ Static files copied to standalone')
    }
    
    const publicDir = path.join(PACKAGE_ROOT, 'public')
    const standalonePublicDir = path.join(standaloneDir, 'public')
    
    if (fs.existsSync(publicDir) && !fs.existsSync(standalonePublicDir)) {
      execSync(`cp -r "${publicDir}" "${standaloneDir}/"`, { stdio: 'inherit' })
      console.log('✓ Public files copied to standalone')
    }
    
    const prismaClientDir = path.join(PACKAGE_ROOT, 'node_modules', '.prisma', 'client')
    const standaloneNodeModules = path.join(standaloneDir, 'node_modules')
    const standalonePrismaDir = path.join(standaloneNodeModules, '.prisma')
    const standaloneClientDir = path.join(standalonePrismaDir, 'client')
    
    if (fs.existsSync(prismaClientDir)) {
      fs.mkdirSync(standalonePrismaDir, { recursive: true })
      
      if (fs.existsSync(standaloneClientDir)) {
        fs.rmSync(standaloneClientDir, { recursive: true, force: true })
      }
      
      execSync(`cp -r "${prismaClientDir}" "${standalonePrismaDir}/"`, { stdio: 'inherit' })
      console.log('✓ Prisma client copied to standalone')
    }
    
    const pgDir = path.join(PACKAGE_ROOT, 'node_modules', 'pg')
    if (fs.existsSync(pgDir)) {
      if (!fs.existsSync(standaloneNodeModules)) {
        fs.mkdirSync(standaloneNodeModules, { recursive: true })
      }
      const standalonePgDir = path.join(standaloneNodeModules, 'pg')
      if (!fs.existsSync(standalonePgDir)) {
        execSync(`cp -r "${pgDir}" "${standaloneNodeModules}/"`, { stdio: 'inherit' })
        console.log('✓ pg module copied to standalone')
      }
    }
    
    const chunksDir = path.join(standaloneDir, '.next', 'server', 'chunks')
    if (fs.existsSync(chunksDir)) {
      const chunkFiles = fs.readdirSync(chunksDir).filter(f => f.endsWith('.js'))
      let foundPrismaHash = null
      let foundPgHash = null
      
      for (const file of chunkFiles) {
        const filePath = path.join(chunksDir, file)
        const content = fs.readFileSync(filePath, 'utf8')
        
        if (!foundPrismaHash) {
          const prismaHashMatch = content.match(/@prisma\/client-([a-f0-9]+)/)
          if (prismaHashMatch) {
            foundPrismaHash = prismaHashMatch[1]
          }
        }
        
        if (!foundPgHash) {
          const pgHashMatch = content.match(/["']pg-([a-f0-9]+)["']/)
          if (pgHashMatch) {
            foundPgHash = pgHashMatch[1]
          }
        }
        
        if (foundPrismaHash && foundPgHash) {
          break
        }
      }
      
      if (foundPrismaHash) {
        const hashName = `@prisma/client-${foundPrismaHash}`
        const hashDir = path.join(standaloneNodeModules, hashName)
        
        if (!fs.existsSync(hashDir)) {
          fs.mkdirSync(path.dirname(hashDir), { recursive: true })
          fs.symlinkSync(standaloneClientDir, hashDir, 'dir')
          console.log(`✓ Created symlink: ${hashName} -> .prisma/client`)
        }
      } else {
        console.log('⚠️  Could not find Prisma hash in build output')
      }
      
      if (foundPgHash) {
        const pgHashName = `pg-${foundPgHash}`
        const pgHashDir = path.join(standaloneNodeModules, pgHashName)
        const pgTargetDir = path.join(standaloneNodeModules, 'pg')
        
        if (!fs.existsSync(pgHashDir) && fs.existsSync(pgTargetDir)) {
          fs.symlinkSync(pgTargetDir, pgHashDir, 'dir')
          console.log(`✓ Created symlink: ${pgHashName} -> pg`)
        }
      } else {
        console.log('⚠️  Could not find pg hash in build output')
      }
    }
    console.log()
  }
  
  console.log('=== Initialization Complete ===')
  console.log('\nStart the service with:')
  console.log('  npx skill-insight start')
  console.log('\nOr specify a custom port:')
  console.log('  npx skill-insight start --port 3001')
  console.log('\nAccess the dashboard at: http://localhost:3000')
} catch (error) {
  console.error('\n❌ Initialization failed:', error.message)
  process.exit(1)
}
