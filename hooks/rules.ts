// Reglas locales (regex) sobre cada llamada a herramienta. Cero llamadas al modelo.
// No es un sandbox: es una capa que atrapa errores y evasiones comunes.

export type Sev = 'critical' | 'high'
export type Hit = { rule: string; sev: Sev; why: string }

type Rule = { id: string; sev: Sev; why: string; re: RegExp }

const HOME = String.raw`(~|\$HOME|\$\{HOME\}|%USERPROFILE%|\$env:USERPROFILE)`

// Se prueban sobre cada segmento ya normalizado (sin comillas ni escapes).
const CMD: Rule[] = [
  { id: 'rm-root', sev: 'critical', why: 'borrado recursivo de raíz, home o comodín',
    re: new RegExp(String.raw`\brm\s+(-\w*[rR]\w*\s+|--recursive\s+)+(-\w+\s+)*(/|/\*|${HOME}/?\*?|\.\.?/?\*?|\*|[a-z]:[\\/]?)(\s|$)`, 'i') },
  { id: 'ps-rm-root', sev: 'critical', why: 'Remove-Item recursivo sobre raíz o home',
    re: new RegExp(String.raw`\bremove-item\b.*-recurse.*\s(/|[a-z]:[\\/]?|${HOME}[\\/]?)(\s|$)`, 'i') },
  { id: 'disk-wipe', sev: 'critical', why: 'escritura directa a disco o formateo',
    re: /\b(mkfs(\.\w+)?|dd\s+.*\bof=\/dev\/|format\s+[a-z]:)/i },
  { id: 'fork-bomb', sev: 'critical', why: 'fork bomb', re: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}/ },
  { id: 'pipe-shell', sev: 'critical', why: 'descarga ejecutada directo en la shell',
    re: /\b(curl|wget|iwr|invoke-webrequest|irm|invoke-restmethod)\b.*\|\s*(sudo\s+)?(ba|z|da)?sh\b|\b(iwr|irm|invoke-webrequest|invoke-restmethod)\b.*\|\s*(iex|invoke-expression)\b/i },
  { id: 'force-push', sev: 'high', why: 'push forzado (reescribe historia remota)',
    re: /\bgit\s+push\b.*(\s--force(?!-with-lease)\b|\s-f\b|\s\+\S+)/i },
  { id: 'git-destroy', sev: 'high', why: 'descarta cambios locales sin respaldo',
    re: /\bgit\s+(reset\s+--hard|clean\s+-\w*[fdx]\w*[fdx]|checkout\s+--\s+\.)/i },
  { id: 'sql-drop', sev: 'high', why: 'borra tablas o bases de datos', re: /\b(drop\s+(table|database|schema)|truncate\s+table)\b/i },
  { id: 'chmod-777', sev: 'high', why: 'permisos abiertos a todos', re: /\bchmod\s+(-R\s+)?0?777\b/i },
  { id: 'exfil', sev: 'critical', why: 'envía un archivo o el entorno por red',
    re: /\b(curl|wget)\b.*(\s-d\s*@|--data(-binary|-raw)?\s*@|-F\s*\S+=@|--upload-file|-T\s)|\b(env|printenv)\b.*\|\s*(curl|nc|wget)\b|\bnc\s+-\w*\s*\S+\s+\d+\s*<\s*\S/i },
  { id: 'opaque', sev: 'high', why: 'comando codificado u opaco que no se puede revisar',
    re: /\bbase64\s+(-d|--decode)\b.*\|\s*(ba|z)?sh\b|-enc(odedcommand)?\s+[A-Za-z0-9+/=]{16,}|\beval\s+["$`]/i },
  { id: 'remote-pkg', sev: 'high', why: 'instala un paquete desde URL o tarball',
    re: /\b(npm|pnpm|yarn)\s+(i|install|add)\b.*\s(https?:|git\+|\S+\.tgz)|\bpip3?\s+install\b.*\s(https?:|git\+)/i },
]

// Rutas de secretos: leer, editar o escribir.
const SECRET_PATH = /(^|[\\/])(\.env(\.(?!example|sample|template)[\w.-]+)?|id_(rsa|ed25519|ecdsa|dsa)(\.pub)?|\.npmrc|\.pypirc|\.netrc|credentials|kubeconfig|[\w.-]+\.(pem|key|p12|pfx))$|[\\/]\.ssh[\\/]|[\\/]\.aws[\\/]/i
// El propio guard y la configuración de Claude: el agente no se desactiva solo.
const SELF_PATH = /[\\/]\.claude[\\/](settings(\.local)?\.json|mods[\\/]guard[\\/])/i
// Tokens con forma conocida dentro de lo que se escribe.
const TOKEN = /\b(AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_\w{40,}|sk-(ant-|proj-)?[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/

const SHELL_READ = /\b(cat|type|get-content|gc|less|more|head|tail|cp|copy|scp|base64|xxd)\b/i

// Quita comillas y escapes, para que r''m, "rm" y \rm cuenten como rm.
export function normalize(s: string): string {
  return s.replace(/\\\r?\n/g, ' ').replace(/(["'`])\1/g, '').replace(/(^|\s)\\(?=\w)/g, '$1').replace(/["']/g, '')
}

// Parte por separadores de shell y abre bash -c / sh -c / $( ) / backticks.
export function segments(cmd: string, depth = 0): string[] {
  if (depth > 3) return [cmd]
  const out: string[] = [cmd]
  const inner = [...cmd.matchAll(/\b(?:ba|z|da)?sh\s+-c\s+(["'])([\s\S]*?)\1|\$\(([^()]*)\)|`([^`]*)`|powershell(?:\.exe)?\s+(?:-\w+\s+)*-c(?:ommand)?\s+(["'])([\s\S]*?)\5/gi)]
  for (const m of inner) {
    const body = m[2] ?? m[3] ?? m[4] ?? m[6]
    if (body) out.push(...segments(body, depth + 1))
  }
  // shortcut: no entiende comillas al partir, puede sobre-partir; basta para reglas por segmento.
  out.push(...cmd.split(/\s*(?:;|&&|\|\||\r?\n)\s*/).filter(p => p && p !== cmd))
  return out
}

// Variables triviales: X=rm; $X -rf / → rm -rf /
function expandVars(cmd: string): string {
  const vars = new Map<string, string>()
  for (const m of cmd.matchAll(/(?:^|[;&\s])([A-Za-z_]\w*)=([^\s;&|]+)/g)) vars.set(m[1], m[2])
  return vars.size ? cmd.replace(/\$\{?([A-Za-z_]\w*)\}?/g, (all, k) => vars.get(k) ?? all) : cmd
}

export function checkCommand(raw: string): Hit | undefined {
  const cmd = expandVars(normalize(raw))
  for (const seg of segments(cmd)) {
    for (const r of CMD) if (r.re.test(seg)) return { rule: r.id, sev: r.sev, why: r.why }
    if (SHELL_READ.test(seg) && seg.split(/\s+/).some(w => SECRET_PATH.test(w))) {
      return { rule: 'secret-read', sev: 'high', why: 'lee un archivo de secretos desde la shell' }
    }
  }
  return undefined
}

export function checkPath(path: string, writing: boolean): Hit | undefined {
  if (writing && SELF_PATH.test(path)) return { rule: 'self-config', sev: 'critical', why: 'edita la configuración de Claude o del propio guard' }
  if (SECRET_PATH.test(path)) return { rule: 'secret-file', sev: 'high', why: 'toca un archivo de secretos' }
  return undefined
}

export function checkContent(text: string): Hit | undefined {
  return TOKEN.test(text) ? { rule: 'secret-in-code', sev: 'high', why: 'escribe algo con forma de clave o token' } : undefined
}

// Punto único: qué revisar según la herramienta.
export function check(tool: string, input: any): Hit | undefined {
  if (tool === 'Bash' || tool === 'PowerShell') return checkCommand(String(input?.command ?? ''))
  const path = String(input?.file_path ?? input?.notebook_path ?? '')
  if (tool === 'Read') return path ? checkPath(path, false) : undefined
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    const text = [input?.content, input?.new_string, input?.new_source, ...(input?.edits ?? []).map((x: any) => x?.new_string)].filter(Boolean).join('\n')
    return (path && checkPath(path, true)) || checkContent(text)
  }
  return undefined
}

// Revisión antes de commit: se apoya en las skills de Trail of Bits (trailofbits/skills).
export const isCommit = (cmd: string) => /\bgit\s+(commit|push)\b/i.test(normalize(cmd))
export const isEdit = (tool: string) => /^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool)
export const isReview = (name: string) => /guard-review|differential-review|diff-review|security-review/i.test(name)
export const isPkgInstall = (cmd: string) =>
  /\b(npm|pnpm|yarn|bun)\s+(i|install|add)\s+(?!-)\S|\bpip3?\s+install\s+(?!-r\b)(?!-e\b)\S|\bcargo\s+add\b|\bgo\s+get\b/i.test(normalize(cmd))
export const TOB = ['differential-review', 'supply-chain-risk-auditor']
// enabledPlugins usa claves "<plugin>@<marketplace>".
export const missingTob = (enabled: unknown) => {
  const keys = Object.entries((enabled ?? {}) as Record<string, unknown>).filter(([, on]) => on).map(([k]) => k.split('@')[0])
  return TOB.filter(p => !keys.includes(p))
}
export const installLines = (names: string[]) => names.map(n => `/plugin install ${n} --marketplace trailofbits/skills`)
export const NO_REVIEW: Hit = { rule: 'no-review', sev: 'high', why: 'commit/push sin revisión de seguridad del diff' }

// critical bloquea siempre; high bloquea solo en modo 'bloquear'.
export type Mode = 'avisar' | 'bloquear'
export const blocks = (h: Hit, mode: Mode, allowed: readonly string[]) =>
  !allowed.includes(h.rule) && (h.sev === 'critical' || mode === 'bloquear')
