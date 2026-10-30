// Where a pasted image or a dropped file has to go. A terminal carries only text, so
// HERA types a path, and that path has to be one the program on the other side can open:
// - A WSL tab runs Linux programs: C:\… is typed as /mnt/c/… (the root from `wslpath`).
// - A tab whose shell is running an interactive `ssh` login is talking to another machine.
//   With the `sshPaste` setting the file is first copied there by the same ssh, with the
//   same login options, folder and environment, and the remote path is typed. ssh runs in
//   batch mode: when it would have to ask for a password or a new host key, nothing is
//   copied and the notice says why. HERA itself opens no connection and stores no credential.
import { execFile, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream'

import { t } from '../shared/i18n'
import type { PasteResult } from '../shared/types'
import { imagePreview, saveClipboardImage, saveDroppedImage } from './paste-image'
import { isWin } from './paths'
import { sessionShell } from './pty-host'
import { getConfig } from './store'

type WslTarget = { kind: 'wsl'; wsl: string; distro: string | null }
type SshTarget = { kind: 'ssh'; ssh: string; options: string[]; destination: string; pid: number; cwd?: string; env: Record<string, string> }
type Target = { kind: 'local' } | WslTarget | SshTarget

const LOCAL: Target = { kind: 'local' }

function run(file: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 8 << 20, encoding: 'utf8' }, (error, stdout) => (error ? reject(error) : resolve(stdout)))
  })
}

function isDir(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory()
  } catch {
    return false
  }
}

async function targetOf(sessionId: string): Promise<Target> {
  const shell = sessionShell(sessionId)

  if (!shell) return LOCAL

  const wsl = wslOf(shell)
  if (wsl) return wsl
  if (!getConfig().settings.sshPaste) return LOCAL

  const login = await sshUnder(shell.pid).catch(() => null)

  // The copy runs as the tab's shell would run it: `-i ./key`, `-F conf` and ssh-agent variables keep working.
  return login ? { ...login, cwd: isDir(shell.cwd) ? shell.cwd : undefined, env: { ...shell.env, ...login.env } } : LOCAL
}

// ---- WSL

function wslOf(shell: { command: string; args: string[] }): WslTarget | null {
  if (!isWin) return null

  const exe = path.basename(shell.command).toLowerCase()
  // System32\bash.exe is the old WSL launcher, not Git Bash.
  const legacy = exe === 'bash.exe' && path.dirname(shell.command).toLowerCase().endsWith('system32')

  if (exe !== 'wsl.exe' && exe !== 'wsl' && !legacy) return null

  let distro: string | null = null
  for (let index = 0; index < shell.args.length; index++) {
    const arg = shell.args[index]
    if ((arg === '-d' || arg === '--distribution') && shell.args[index + 1]) distro = shell.args[++index]
    else if (arg.startsWith('--distribution=')) distro = arg.slice('--distribution='.length)
  }

  return { kind: 'wsl', wsl: legacy ? path.join(path.dirname(shell.command), 'wsl.exe') : shell.command, distro }
}

/** C:\Users\me\a.png → /mnt/c/Users/me/a.png, \\wsl$\Ubuntu\home\me → /home/me. */
export function wslPathOf(file: string, root = '/mnt/'): string {
  const unc = file.match(/^\\\\(?:wsl\$|wsl\.localhost)\\[^\\]+(\\.*)?$/i)
  if (unc) return (unc[1] || '/').replace(/\\/g, '/')

  const drive = file.match(/^([A-Za-z]):[\\/]*(.*)$/)
  if (drive) return `${root}${drive[1].toLowerCase()}${drive[2] ? `/${drive[2].replace(/\\/g, '/')}` : ''}`

  return file.replace(/\\/g, '/')
}

/** Where each distro mounts the Windows drives: /mnt/ unless its /etc/wsl.conf says otherwise. */
const wslRoots = new Map<string, string>()

async function wslRoot(target: WslTarget): Promise<string> {
  const known = wslRoots.get(target.distro || '')
  if (known) return known

  // One wslpath call for the whole paste, not one per dropped file.
  const args = [...(target.distro ? ['-d', target.distro] : []), '-e', 'wslpath', '-u', 'C:\\']
  const line = (await run(target.wsl, args, 5000).catch(() => '')).trim().split('\n')[0]?.trim() || ''

  if (!/^\/(.*\/)?c\/?$/.test(line)) return '/mnt/'

  const root = line.replace(/c\/?$/, '')
  wslRoots.set(target.distro || '', root)

  return root
}

// ---- ssh

interface Proc {
  pid: number
  ppid: number
  name: string
  exe?: string
  args?: string[]
  /** In its terminal's foreground process group (macOS, Linux); Windows does not say. */
  foreground?: boolean
}

const SHELL = /^-?(pwsh|powershell|cmd|bash|zsh|fish|sh|dash|ksh|tcsh|csh|nu|xonsh)(\.exe)?$/i
const SSH = /^ssh(\.exe)?$/i

/** OpenSSH client options that take a value. */
const VALUE = new Set([...'BbcDEeFIiJLlmOoPpQRSWw'])
/** Of those, the ones that say how to log in; port forwards, tty, master and logging are left out. */
const KEEP_VALUE = new Set([...'BbcFIiJlmopS'])
const KEEP_FLAG = new Set([...'46CKk'])
/**
 * Not an interactive login: config dump, version, control command, query, stdio forward,
 * no command, background, no tty, stdin from /dev/null, subsystem.
 */
const NOT_LOGIN = new Set([...'GVOQWNfTns'])

/**
 * The login options and destination of an ssh command line (without the program), or
 * null when it is not an interactive login. Like ssh, options may follow the destination.
 * A remote command makes it a login only with a tty (`ssh -t host tmux a`); without one
 * (`ssh backup rsync …`, `ssh host tail -f log`) the screen belongs to that command.
 */
export function parseSsh(args: string[]): { options: string[]; destination: string } | null {
  const options: string[] = []
  let destination = ''
  let tty = false

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]

    if (arg === '--') {
      const rest = args.slice(index + 1)
      if (!destination) destination = rest.shift() || ''
      if (rest.length && !tty) return null
      break
    }
    if (arg.length < 2 || !arg.startsWith('-')) {
      if (destination) {
        if (!tty) return null
        break
      }
      destination = arg
      continue
    }

    for (let at = 1; at < arg.length; at++) {
      const flag = arg[at]

      if (NOT_LOGIN.has(flag)) return null
      if (flag === 't') tty = true
      if (VALUE.has(flag)) {
        const value = at + 1 < arg.length ? arg.slice(at + 1) : args[++index]
        if (value === undefined) return null
        if (KEEP_VALUE.has(flag)) options.push(`-${flag}`, value)
        break
      }
      if (KEEP_FLAG.has(flag)) options.push(`-${flag}`)
    }
  }

  return destination && !destination.startsWith('-') ? { options, destination } : null
}

/**
 * The arguments of a Windows command line, without the program, by the rules programs
 * built with the Microsoft C runtime use (CommandLineToArgvW). `exe` is the program's
 * path: CreateProcess also runs `C:\Program Files\…\ssh.exe` unquoted.
 */
export function windowsArgs(line: string, exe?: string): string[] {
  let rest = line.trimStart()

  if (rest.startsWith('"')) rest = rest.indexOf('"', 1) < 0 ? '' : rest.slice(rest.indexOf('"', 1) + 1)
  else if (exe && rest.toLowerCase().startsWith(exe.toLowerCase())) rest = rest.slice(exe.length)
  else rest = rest.replace(/^\S+/, '')

  const args: string[] = []
  let word = ''
  let inWord = false
  let quoted = false

  for (let index = 0; index < rest.length; index++) {
    const char = rest[index]

    if (char === '\\') {
      let count = 0
      while (rest[index] === '\\') {
        count++
        index++
      }
      if (rest[index] === '"') {
        // 2n backslashes and a quote: n backslashes, then the quote opens or closes; 2n+1: a literal quote.
        word += '\\'.repeat(count >> 1)
        if (count % 2) word += '"'
        else quoted = !quoted
      } else {
        word += '\\'.repeat(count)
        index--
      }
      inWord = true
    } else if (char === '"') {
      if (quoted && rest[index + 1] === '"') {
        word += '"'
        index++
      } else quoted = !quoted
      inWord = true
    } else if (!quoted && (char === ' ' || char === '\t')) {
      if (inWord) args.push(word)
      word = ''
      inWord = false
    } else {
      word += char
      inWord = true
    }
  }
  if (inWord) args.push(word)

  return args
}

/** A shell the user types into, not one running a script (`./deploy.sh`) or a command (`sh -c …`). */
export function interactiveShell(args: string[] | undefined): boolean {
  if (!args) return false
  if (args.some(arg => /^-noninteractive$/i.test(arg))) return false
  if (args.some(arg => /^(-noexit|\/k)$/i.test(arg))) return true
  if (args.some(arg => /^(-command|-encodedcommand|-file|\/c)$/i.test(arg) || /^-[a-z]*c[a-z]*$/.test(arg))) return false
  if (args.some(arg => /^-[a-z]*i[a-z]*$/.test(arg) || arg === '--interactive' || arg === '--login')) return true

  return !args.some(arg => !arg.startsWith('-') && !arg.startsWith('/'))
}

async function windowsProcesses(): Promise<Proc[]> {
  // No ssh.exe anywhere (the usual case): skip the CIM query, which takes about half a second.
  const tasks = await run('tasklist.exe', ['/FI', 'IMAGENAME eq ssh.exe', '/FO', 'CSV', '/NH'], 5000).catch(() => '')
  if (!/"ssh\.exe"/i.test(tasks)) return []

  const names = ['ssh', 'pwsh', 'powershell', 'cmd', 'bash', 'sh', 'zsh', 'fish', 'nu'].map(name => `Name='${name}.exe'`).join(' OR ')
  // UTF-8 out: a Korean folder in `-i` or `-F` would otherwise arrive in the console code page.
  const script = `[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-CimInstance Win32_Process -Filter "${names}" | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress`
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const out = await run(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], 10_000)
  const rows = [JSON.parse(out || '[]')].flat() as { ProcessId: number; ParentProcessId: number; Name: string; ExecutablePath?: string; CommandLine?: string }[]
  const procs: Proc[] = rows.map(row => ({
    pid: row.ProcessId,
    ppid: row.ParentProcessId,
    name: row.Name,
    exe: row.ExecutablePath || undefined,
    args: row.CommandLine ? windowsArgs(row.CommandLine, row.ExecutablePath) : undefined
  }))

  // Git Bash (MSYS) and Cygwin emulate fork: the Windows parent of their ssh.exe is a
  // process that has already exited. Their own `ps` still knows the real parent; it is
  // run only from a folder that holds that runtime.
  const runtimes = new Set(procs.filter(proc => SSH.test(proc.name) && proc.exe).map(proc => path.dirname(proc.exe!)))
  for (const dir of [...runtimes].filter(dir => ['msys-2.0.dll', 'cygwin1.dll'].some(dll => fs.existsSync(path.join(dir, dll))))) {
    const table = (await run(path.join(dir, 'ps.exe'), [], 5000).catch(() => '')).split('\n').flatMap(line => {
      // PID PPID PGID WINPID …, after an optional status letter.
      const match = line.match(/^\s*[A-Z]?\s+(\d+)\s+(\d+)\s+\d+\s+(\d+)\s/)
      return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), winpid: Number(match[3]) }] : []
    })
    const winpid = new Map(table.map(row => [row.pid, row.winpid]))

    for (const row of table) {
      const parent = winpid.get(row.ppid)
      const proc = procs.find(proc => proc.pid === row.winpid)
      if (parent && proc) proc.ppid = parent
    }
  }

  return procs
}

async function unixProcesses(): Promise<Proc[]> {
  const out = await run('ps', ['-A', '-o', 'pid=,ppid=,pgid=,tpgid=,comm='], 5000)

  return out.split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(.+)$/)
    // macOS prints the executable's path, Linux its name.
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), name: path.basename(match[5].trim()), foreground: match[3] === match[4] }] : []
  })
}

async function unixArgs(pid: number): Promise<string[] | undefined> {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean).slice(1)
  } catch {
    // macOS has no /proc: ps prints the arguments joined by spaces (a path with a space splits).
    const line = await run('ps', ['-ww', '-o', 'args=', '-p', String(pid)], 5000).catch(() => '')

    return line.trim() ? line.trim().split(/\s+/).slice(1) : undefined
  }
}

/** ssh-agent variables of a running ssh (Linux; elsewhere the tab's environment has to do). */
function agentEnv(pid: number): Record<string, string> {
  try {
    const vars = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').map(entry => entry.split(/=(.*)/s, 2))

    return Object.fromEntries(vars.filter(([key]) => key === 'SSH_AUTH_SOCK' || key === 'SSH_AGENT_PID'))
  } catch {
    return {}
  }
}

/** The ssh login running in this shell: its child, or the child of a shell the user started inside it. */
async function sshUnder(shellPid: number): Promise<Omit<SshTarget, 'cwd'> | null> {
  const procs = isWin ? await windowsProcesses() : await unixProcesses()
  const children = new Map<number, Proc[]>()
  for (const proc of procs) children.set(proc.ppid, [...(children.get(proc.ppid) || []), proc])
  const argsOf = async (proc: Proc) => proc.args ?? (isWin ? undefined : await unixArgs(proc.pid))

  // Through shells only: an ssh that git, an agent or a script started is not the tab's login.
  let level = children.get(shellPid) || []
  for (let depth = 0; depth < 4 && level.length; depth++) {
    for (const proc of level.filter(proc => SSH.test(proc.name) && proc.foreground !== false).sort((a, b) => b.pid - a.pid)) {
      const args = await argsOf(proc)
      const login = args && parseSsh(args)

      if (login) return { kind: 'ssh', ssh: proc.exe || (isWin ? 'ssh.exe' : 'ssh'), ...login, pid: proc.pid, env: isWin ? {} : agentEnv(proc.pid) }
    }

    const shells: Proc[] = []
    for (const proc of level.filter(proc => SHELL.test(proc.name))) if (interactiveShell(await argsOf(proc))) shells.push(proc)
    level = shells.flatMap(proc => children.get(proc.pid) || [])
  }

  return null
}

/**
 * Ours come first: ssh keeps the first value it gets for an option. No password or host
 * key prompt, no tty, no remote command or forwarding from the user's config, and an
 * existing control master is used but no new one is left running.
 */
const UPLOAD_OPTIONS = ['-T', ...['BatchMode=yes', 'ConnectTimeout=10', 'RemoteCommand=none', 'RequestTTY=no', 'ClearAllForwardings=yes', 'PermitLocalCommand=no', 'ForwardAgent=no', 'ForwardX11=no', 'ControlMaster=no', 'LogLevel=ERROR'].flatMap(option => ['-o', option])]
/**
 * ssh logins whose copy could not log in (no key, a host key question), by ssh process:
 * not tried again until the user logs in anew, so pastes do not pile up failed logins in
 * the server's log (fail2ban and the like count them).
 */
const failedLogins = new Map<number, { reason: string; at: number }>()
/** A process id comes back one day: forget a failure after this long. */
const FAILED_MS = 30 * 60_000
/** ssh's own refusals; a `Permission denied` from mkdir or cat on the server is not one. */
const LOGIN_FAILED = /permission denied \(|host key verification failed|remote host identification/i
type LoginError = Error & { login?: boolean }
/** At most this much per paste or drop over ssh: each file is one login, each login a line in the server's log. */
const MAX_FILES = 10
const MAX_UPLOAD = 64 << 20
const UPLOAD_MS = 60_000
/** What the server's `pwd` may print to be typed into a terminal: a plain absolute path, no control characters or quotes. */
const REMOTE_DIR = /^\/[\p{L}\p{N}_@%+=:,.~/ -]*$/u

/** Copies stdin to ~/.cache/hera-paste/<name> (mode 600, a week kept) and prints the folder. POSIX sh, no quotes. */
const uploadScript = (name: string) =>
  `umask 077 && mkdir -p ~/.cache/hera-paste && cd ~/.cache/hera-paste && { find . -type f -mtime +7 -exec rm -f {} + 2>/dev/null; true; } && cat > ${name} && pwd`

/** A name safe in that script and on any server: a random prefix, the original name's tame part, its extension. */
export function remoteName(file: string): string {
  const base = path.basename(file)

  if (/^paste-\d{8}-\d{6}-[0-9a-f]{8}\.[a-z]+$/.test(base)) return base

  const dot = base.lastIndexOf('.')
  // Agent CLIs tell an image by its extension: keep it.
  const ext = dot > 0 ? base.slice(dot + 1).replace(/[^A-Za-z0-9]/g, '').slice(0, 10) : ''
  const stem = (dot > 0 ? base.slice(0, dot) : base).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._-]+/, '').slice(0, 60)

  return `drop-${crypto.randomBytes(3).toString('hex')}-${stem || 'file'}${ext ? `.${ext}` : ''}`
}

function sshReason(stderr: string, code: number | null): string {
  if (/permission denied \(/i.test(stderr)) return t('키로 로그인하지 못했습니다. HERA 는 비밀번호를 대신 입력하지 않으니 ssh 키(ssh-agent)를 쓰세요')
  if (/host key verification failed|remote host identification/i.test(stderr)) return t('서버의 호스트 키를 확인하지 못했습니다')
  if (/could not resolve|connection refused|timed out|network is unreachable/i.test(stderr)) return t('서버에 다시 연결하지 못했습니다')
  if (/sh: (not found|command not found)|is not recognized/i.test(stderr)) return t('서버에서 sh 를 쓸 수 없습니다 (Linux · macOS 서버만 지원)')

  const last = stderr.trim().split(/\r?\n/).filter(Boolean).pop()

  return last ? last.replace(/[\p{Cc}]/gu, '').slice(0, 200) : t('ssh 가 code {code} 로 끝났습니다', { code: code ?? '?' })
}

function upload(target: SshTarget, file: string): Promise<string> {
  const name = remoteName(file)

  return new Promise((resolve, reject) => {
    // `--`: the destination is never read as an option.
    const args = [...UPLOAD_OPTIONS, ...target.options, '--', target.destination, `sh -c '${uploadScript(name)}'`]
    const child = spawn(target.ssh, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], cwd: target.cwd, env: target.env })
    const source = fs.createReadStream(file)
    let stdout = ''
    let stderr = ''
    let readError: Error | null = null
    let settled = false
    const settle = (finish: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      finish()
    }
    const timer = setTimeout(() => {
      source.destroy()
      child.kill()
      settle(() => reject(new Error(t('서버에 다시 연결하지 못했습니다'))))
    }, UPLOAD_MS)

    child.stdout.on('data', chunk => (stdout += chunk))
    child.stderr.on('data', chunk => (stderr += chunk))
    child.on('error', error => settle(() => reject(error)))
    // A file that cannot be read to the end must not arrive on the server cut short.
    source.on('error', error => {
      readError = error
      child.kill()
    })
    child.on('close', code => {
      const dir = stdout.trim().split(/\r?\n/).pop()?.trim() || ''

      if (readError) settle(() => reject(new Error(t('파일을 읽지 못했습니다: {reason}', { reason: readError!.message }))))
      else if (code !== 0) settle(() => reject(Object.assign(new Error(sshReason(stderr, code)), { login: LOGIN_FAILED.test(stderr) })))
      else if (!REMOTE_DIR.test(dir)) settle(() => reject(new Error(t('서버가 알려 준 폴더를 쓸 수 없습니다'))))
      else settle(() => resolve(`${dir.replace(/\/$/, '')}/${name}`))
    })

    // ssh that gives up early closes its stdin under the copy: its own reason is reported, not EPIPE.
    pipeline(source, child.stdin, () => undefined)
  })
}

/** Plain files only, and not too many: a folder or a disk image is not something to paste. */
function checkUpload(files: string[]): string | null {
  if (files.length > MAX_FILES) return t('한 번에 파일 {count}개까지만 서버로 올립니다', { count: MAX_FILES })

  let total = 0
  for (const file of files) {
    const stat = fs.statSync(file, { throwIfNoEntry: false })
    if (!stat?.isFile()) return t('폴더는 서버로 올리지 않습니다: {name}', { name: path.basename(file) })
    total += stat.size
  }

  return total > MAX_UPLOAD ? t('{size}MB 넘게는 서버로 올리지 않습니다', { size: MAX_UPLOAD >> 20 }) : null
}

// ---- delivery

async function deliver(target: Target, files: string[]): Promise<PasteResult> {
  if (target.kind === 'local') return { paths: files, where: 'local', posix: false }
  if (target.kind === 'wsl') {
    const root = await wslRoot(target)

    return { paths: files.map(file => wslPathOf(file, root)), where: 'wsl', posix: true }
  }

  const result: PasteResult = { paths: [], where: 'ssh', host: target.destination, posix: true }
  const failed = failedLogins.get(target.pid)
  const refused = checkUpload(files) || (failed && Date.now() - failed.at < FAILED_MS ? failed.reason : null)

  if (refused) return { ...result, error: refused }

  // One at a time: a key that needs a touch or a slow link should not face a burst.
  for (const file of files) {
    try {
      result.paths.push(await upload(target, file))
    } catch (error) {
      const reason = (error as Error).message
      if ((error as LoginError).login) failedLogins.set(target.pid, { reason, at: Date.now() })

      return { ...result, error: reason }
    }
  }

  return result
}

/** The clipboard image, saved here and delivered to where the tab's programs run; null when there is none. */
export async function pasteClipboardImage(sessionId: string): Promise<PasteResult | null> {
  // Looking at the tab takes a moment on Windows: do it while the image is saved.
  const [file, target] = await Promise.all([saveClipboardImage(), targetOf(sessionId)])

  if (!file) return null

  return { ...(await deliver(target, [file])), preview: imagePreview(file), bytes: fs.statSync(file).size }
}

/** Files dropped on a terminal (from Explorer / Finder or the folder tree). */
export async function pasteFiles(sessionId: string, files: string[]): Promise<PasteResult> {
  return deliver(await targetOf(sessionId), files.filter(file => typeof file === 'string' && path.isAbsolute(file)))
}

/** An image dropped with no file of its own (from a browser); null when the bytes are not an image. */
export async function pasteImageBytes(sessionId: string, data: Uint8Array): Promise<PasteResult | null> {
  const file = saveDroppedImage(Buffer.from(data))

  if (!file) return null

  return { ...(await deliver(await targetOf(sessionId), [file])), preview: imagePreview(file), bytes: data.byteLength }
}
