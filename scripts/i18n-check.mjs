// Checks the UI text: every t('…') key has an English entry, and no Korean string
// literal is left outside t(). Comments and strings marked `// i18n-ignore` are skipped.
//   node scripts/i18n-check.mjs [file ...]     (default: src, electron, shared)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HANGUL = /[가-힣]/

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'i18n' ? [] : files(full)
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : []
  })
}

/** English dictionary: keys of every `'…': '…'` / `"…": …` row in shared/i18n/en-*.ts. */
function dictionary() {
  const keys = new Set()
  const dir = path.join(root, 'shared', 'i18n')
  for (const name of fs.readdirSync(dir).filter(file => /^en-.*\.ts$/.test(file))) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8')
    for (const match of text.matchAll(/^\s*(['"`])((?:\\.|(?!\1).)*)\1\s*:/gm)) keys.add(unescape(match[2]))
  }
  return keys
}

function unescape(text) {
  return text.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n')
}

/** Strip comments, keep strings (good enough for this codebase). */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, block => block.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
}

const targets = process.argv.slice(2).length ? process.argv.slice(2).map(file => path.resolve(file)) : ['src', 'electron', 'shared'].flatMap(dir => files(path.join(root, dir)))
const known = dictionary()
let missing = 0
let loose = 0

for (const file of targets) {
  const source = fs.readFileSync(file, 'utf8')
  const lines = source.split('\n')
  const stripped = code(source)

  // t('…') keys
  for (const match of stripped.matchAll(/\bt\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) {
    const key = unescape(match[2])
    if (!HANGUL.test(key)) continue
    if (match[1] === '`' && key.includes('${')) {
      console.log(`${path.relative(root, file)}: t() with \${} interpolation, use {placeholders}: ${key.slice(0, 60)}`)
      missing++
      continue
    }
    if (!known.has(key)) {
      const line = stripped.slice(0, match.index).split('\n').length
      console.log(`${path.relative(root, file)}:${line}: no English for: ${key.slice(0, 80)}`)
      missing++
    }
  }

  // Korean outside t(): any line with Hangul in code that has no t( on it
  stripped.split('\n').forEach((line, index) => {
    if (!HANGUL.test(line) || lines[index].includes('i18n-ignore')) return
    const withoutT = line.replace(/\bt\(\s*(['"`])(?:\\.|(?!\1).)*\1/g, '')
    if (HANGUL.test(withoutT)) {
      console.log(`${path.relative(root, file)}:${index + 1}: Korean outside t(): ${line.trim().slice(0, 90)}`)
      loose++
    }
  })
}

console.log(`\n${missing} missing English, ${loose} Korean lines outside t()`)
process.exit(missing || loose ? 1 : 0)
