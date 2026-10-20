import type { Register } from 'claude-code'

import { blocks, check, installLines, isCommit, missingTob, isEdit, isPkgInstall, isReview, NO_REVIEW, type Hit, type Mode } from './rules'

const MAX_LOG = 50
type Entry = { at: number; tool: string; rule: string; sev: string; why: string; blocked: boolean; what: string }

async function cfg($: any): Promise<{ mode: Mode; allowed: string[] }> {
  return {
    mode: ((await $.store.get('mode')) as Mode) ?? 'avisar',
    allowed: ((await $.store.get('allowed')) as string[]) ?? [],
  }
}

async function log($: any, entry: Entry) {
  const list = ((await $.store.get('log')) as Entry[]) ?? []
  await $.store.set('log', [...list, entry].slice(-MAX_LOG))
  const b = list.filter(x => x.blocked).length + (entry.blocked ? 1 : 0)
  $.ui.status(`🛡 guard: ${b} bloqueos · ${list.length + 1 - b} avisos`)
}

const missing = async ($: any) => { try { return missingTob((await $.settings.read()).enabledPlugins) } catch { return [] } }

const what = (e: any) => String(e.command ?? e.file_path ?? e.notebook_path ?? '').slice(0, 120)

const HELP = [
  '/guard                 bitácora (últimos 15)',
  '/guard avisar          avisa y deja pasar lo "high" (por defecto)',
  '/guard bloquear        bloquea también lo "high"',
  '/guard permitir <regla>  desactiva una regla',
  '/guard quitar <regla>    la vuelve a activar',
  '/guard limpiar         borra la bitácora',
  '/guard ocultar         no avisar más de las skills de Trail of Bits',
].join('\n')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'guard', description: 'Guard: bitácora, modo avisar/bloquear y reglas permitidas' })
    const miss = await missing($)
    if (miss.length && !(await $.store.get('hideTob'))) {
      $.ui.toast(`🛡 guard: faltan skills de Trail of Bits (${miss.join(', ')}). Escribe /guard para ver cómo instalarlas.`)
    }
    return next(e)
  })

  on('command.run', { command: 'guard' }, async ($, e) => {
    const [verb, arg] = e.args.trim().split(/\s+/)
    const { mode, allowed } = await cfg($)
    if (verb === 'avisar' || verb === 'bloquear') {
      await $.store.set('mode', verb)
      return { text: `guard: modo ${verb}. Las reglas "critical" bloquean siempre.` }
    }
    if (verb === 'permitir' && arg) {
      await $.store.set('allowed', [...new Set([...allowed, arg])])
      return { text: `guard: regla ${arg} permitida.` }
    }
    if (verb === 'quitar' && arg) {
      await $.store.set('allowed', allowed.filter(r => r !== arg))
      return { text: `guard: regla ${arg} activa otra vez.` }
    }
    if (verb === 'limpiar') {
      await $.store.set('log', [])
      $.ui.status(undefined)
      return { text: 'guard: bitácora borrada.' }
    }
    if (verb === 'ocultar') {
      await $.store.set('hideTob', true)
      return { text: 'guard: no avisaré más de Trail of Bits.' }
    }
    if (verb) return { text: HELP }
    const list = ((await $.store.get('log')) as Entry[]) ?? []
    const rows = list.slice(-15).reverse().map(x =>
      `${new Date(x.at).toLocaleTimeString()} ${x.blocked ? 'BLOQUEO' : 'aviso  '} ${x.rule} (${x.sev}) ${x.tool}: ${x.what}`)
    const miss = await missing($)
    const tob = miss.length ? ['', `Recomendado: skills de Trail of Bits para revisar el código (faltan ${miss.length}):`, ...installLines(miss)] : []
    return { text: [`guard · modo ${mode}${allowed.length ? ` · permitidas: ${allowed.join(', ')}` : ''}`, ...(rows.length ? rows : ['Sin eventos.']), ...tob, '', HELP].join('\n') }
  })

  // Revisión registrada al usar la skill o el comando de Trail of Bits (o /security-review).
  on('command.run', async ($, e, next) => {
    if (isReview(e.command)) await $.store.set('pending', false)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ev = e as any
    const tool = String(ev.tool ?? '')
    if (tool === 'Skill' && isReview(String(ev.skill ?? ''))) await $.store.set('pending', false)
    const cmd = tool === 'Bash' || tool === 'PowerShell' ? String(ev.command ?? '') : ''
    let hit: Hit | undefined = check(tool, ev)
    if (!hit && cmd && isCommit(cmd) && (await $.store.get('pending'))) hit = NO_REVIEW
    if (!hit) {
      const r = await next(e)
      if (r.deny !== undefined) return r
      if (isEdit(tool)) await $.store.set('pending', true)
      if (cmd && isCommit(cmd) && !r.isError) await $.store.set('pending', false)
      if (cmd && isPkgInstall(cmd)) {
        return { ...r, context: [...(r.context ?? []), 'guard: dependencia nueva. Si está instalada, usa la skill supply-chain-risk-auditor (Trail of Bits) para evaluar su riesgo.'] }
      }
      return r
    }
    const { mode, allowed } = await cfg($)
    if (allowed.includes(hit.rule)) return next(e)
    const blocked = blocks(hit, mode, allowed)
    await log($, { at: Date.now(), tool, rule: hit.rule, sev: hit.sev, why: hit.why, blocked, what: what(ev) })
    const fix = hit.rule === 'no-review' ? ' Usa la skill guard-review (revisión corta del diff) y luego reintenta.' : ''
    if (blocked) {
      $.ui.toast(`🛡 guard bloqueó ${tool}: ${hit.why}`)
      return { deny: `guard: bloqueado (${hit.rule}: ${hit.why}). Si el usuario lo quiere de verdad, que lo ejecute él o use /guard permitir ${hit.rule}.${fix}` }
    }
    $.ui.toast(`🛡 guard: ${hit.why} (${tool})`)
    const r = await next(e)
    if (r.deny !== undefined) return r
    if (cmd && isCommit(cmd) && !r.isError) await $.store.set('pending', false)
    return { ...r, context: [...(r.context ?? []), `guard: aviso ${hit.rule} (${hit.why}). ${fix || 'Confirma que el usuario lo pidió; si no, revierte.'}`] }
  // Si el guard falla, deja pasar (no bloquea el trabajo por un bug propio); el fallo queda en el log de debug.
  }).catch(($, e, next) => next(e))
}
