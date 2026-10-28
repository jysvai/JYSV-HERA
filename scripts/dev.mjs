// Dev loop: vite (renderer HMR) + esbuild --watch (main/preload/cli) + electron.
// Uses an isolated data dir (app/.hera-dev) and pipe so it never touches the
// installed app's projects or answers its `hera` calls.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'
const port = Number(process.env.HERA_DEV_PORT || 5180)
const devHome = process.env.HERA_HOME || path.join(root, '.hera-dev')
fs.mkdirSync(devHome, { recursive: true })

const children = []

function run(command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: isWin,
    env: { ...process.env, ...extraEnv }
  })
  children.push(child)

  return child
}

function shutdown(code = 0) {
  for (const child of children) {
    try {
      child.kill()
    } catch {
      // already gone
    }
  }
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

async function waitFor(url, timeoutMs = 30_000) {
  const started = Date.now()

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // not up yet
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }

  throw new Error(`timed out waiting for ${url}`)
}

async function waitForFile(file, timeoutMs = 30_000) {
  const started = Date.now()

  while (Date.now() - started < timeoutMs) {
    if (fs.existsSync(file)) return
    await new Promise(resolve => setTimeout(resolve, 200))
  }

  throw new Error(`timed out waiting for ${file}`)
}

const mainJs = path.join(root, 'dist', 'main.js')
try {
  fs.rmSync(mainJs, { force: true })
} catch {
  // ignore
}

run('npx', ['vite', '--port', String(port), '--strictPort'])
run('node', ['scripts/build-main.mjs', '--watch'])

await Promise.all([waitFor(`http://localhost:${port}/`), waitForFile(mainJs)])

const electronBin = path.join(root, 'node_modules', 'electron', 'dist', isWin ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron')
// Since Electron 42, npm install no longer downloads the binary; fetch it on the first run.
if (!fs.existsSync(electronBin)) spawnSync(process.execPath, [path.join(root, 'node_modules', 'electron', 'install.js')], { cwd: root, stdio: 'inherit' })
const electron = spawn(electronBin, ['.'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, HERA_DEV_SERVER: `http://localhost:${port}/`, HERA_HOME: devHome, ELECTRON_ENABLE_LOGGING: '1' }
})
children.push(electron)
electron.on('exit', code => shutdown(code ?? 0))
