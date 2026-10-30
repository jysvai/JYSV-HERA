// Bundles the Electron main process, preload, usage worker and the hera CLI
// with esbuild, then writes the CLI shims for Windows / macOS / Linux.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build, context } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const watch = process.argv.includes('--watch')
const dev = watch || process.argv.includes('--dev')

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: dev ? 'inline' : false,
  minify: !dev,
  legalComments: 'none',
  logLevel: 'info'
}

const entries = [
  { entryPoints: [path.join(root, 'electron/main.ts')], outfile: path.join(dist, 'main.js'), external: ['electron', 'node-pty'] },
  { entryPoints: [path.join(root, 'electron/preload.ts')], outfile: path.join(dist, 'preload.js'), external: ['electron'] },
  { entryPoints: [path.join(root, 'electron/usage-worker.ts')], outfile: path.join(dist, 'usage-worker.js'), external: ['electron'] },
  {
    entryPoints: [path.join(root, 'cli/hera.ts')],
    outfile: path.join(dist, 'bin', 'hera.js'),
    external: [],
    banner: { js: '#!/usr/bin/env node' },
    define: { __HERA_VERSION__: JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version) }
  }
]

function writeShims() {
  const bin = path.join(dist, 'bin')
  fs.mkdirSync(bin, { recursive: true })

  // Packaged layout: <app>/resources/bin/hera.cmd -> <app>/jysvhera.exe
  // Dev layout:      app/dist/bin/hera.cmd       -> node_modules/electron/dist/electron.exe
  fs.writeFileSync(
    path.join(bin, 'hera.cmd'),
    // The exit code has to come through: lanes takes 0 from `hera host` as "the tab is open".
    // %ERRORLEVEL% inside an `if (...)` block is read before the block runs, hence the labels.
    [
      '@echo off',
      'where node >nul 2>nul',
      'if errorlevel 1 goto electron',
      'node "%~dp0hera.js" %*',
      'exit /b %ERRORLEVEL%',
      ':electron',
      'set "ELECTRON_RUN_AS_NODE=1"',
      'if not exist "%~dp0..\\..\\jysvhera.exe" goto dev',
      '"%~dp0..\\..\\jysvhera.exe" "%~dp0hera.js" %*',
      'exit /b %ERRORLEVEL%',
      ':dev',
      '"%~dp0..\\..\\node_modules\\electron\\dist\\electron.exe" "%~dp0hera.js" %*',
      'exit /b %ERRORLEVEL%',
      ''
    ].join('\r\n')
  )

  const sh = [
    '#!/bin/sh',
    'DIR="$(cd "$(dirname "$0")" && pwd)"',
    'if command -v node >/dev/null 2>&1; then exec node "$DIR/hera.js" "$@"; fi',
    'export ELECTRON_RUN_AS_NODE=1',
    'for exe in "$DIR/../../MacOS/jysvhera" "$DIR/../../MacOS/JYSV HERA" "$DIR/../../jysvhera" "$DIR/../../node_modules/electron/dist/electron.exe" "$DIR/../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" "$DIR/../../node_modules/electron/dist/electron"; do',
    '  if [ -x "$exe" ]; then exec "$exe" "$DIR/hera.js" "$@"; fi',
    'done',
    'echo "hera: node or JYSV HERA runtime not found" >&2',
    'exit 1',
    ''
  ].join('\n')
  fs.writeFileSync(path.join(bin, 'hera'), sh)

  try {
    fs.chmodSync(path.join(bin, 'hera'), 0o755)
  } catch {
    // windows
  }
}

if (watch) {
  for (const entry of entries) {
    const ctx = await context({ ...common, ...entry })
    await ctx.watch()
  }

  writeShims()
} else {
  await Promise.all(entries.map(entry => build({ ...common, ...entry })))
  writeShims()
}
