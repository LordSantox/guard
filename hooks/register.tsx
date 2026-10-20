import type { Register } from 'claude-code'

import { blocks, check, installLines, isCommit, missingTob, isEdit, isPkgInstall, isReview, NO_REVIEW, type Hit, type Mode } from './rules'

const MAX_LOG = 50
const PANE = 'guard'
type Entry = { at: number; tool: string; rule: string; sev: string; why: string; blocked: boolean; what: string }

async function cfg($: any): Promise<{ mode: Mode; allowed: string[] }> {
  return {
    mode: ((await $.store.get('mode')) as Mode) ?? 'avisar',
    allowed: ((await $.store.get('allowed')) as string[]) ?? [],
  }
}

const save = async ($: any, k: string, v: unknown) => { await $.store.set(k, v); $.ui.invalidate('ui.render') }

async function log($: any, entry: Entry) {
  const list = ((await $.store.get('log')) as Entry[]) ?? []
  await save($, 'log', [...list, entry].slice(-MAX_LOG))
  const b = list.filter(x => x.blocked).length + (entry.blocked ? 1 : 0)
  $.ui.status(`🛡 guard: ${b} bloqueos · ${list.length + 1 - b} avisos`)
}

const missing = async ($: any) => { try { return missingTob((await $.settings.read()).enabledPlugins) } catch { return [] } }

const what = (e: any) => String(e.command ?? e.file_path ?? e.notebook_path ?? '').slice(0, 120)

const HELP = [
  '/guard                 abre el panel',
  '/guard log             bitácora en texto (últimos 15)',
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
      await save($, 'mode', verb)
      return { text: `guard: modo ${verb}. Las reglas "critical" bloquean siempre.` }
    }
    if (verb === 'permitir' && arg) {
      await save($, 'allowed', [...new Set([...allowed, arg])])
      return { text: `guard: regla ${arg} permitida.` }
    }
    if (verb === 'quitar' && arg) {
      await save($, 'allowed', allowed.filter(r => r !== arg))
      return { text: `guard: regla ${arg} activa otra vez.` }
    }
    if (verb === 'limpiar') {
      await save($, 'log', [])
      $.ui.status(undefined)
      return { text: 'guard: bitácora borrada.' }
    }
    if (verb === 'ocultar') {
      await save($, 'hideTob', true)
      return { text: 'guard: no avisaré más de Trail of Bits.' }
    }
    if (!verb) {
      await $.ui.open({ id: PANE, title: 'Guard' })
      return { text: 'Panel guard abierto.' }
    }
    if (verb !== 'log') return { text: HELP }
    const list = ((await $.store.get('log')) as Entry[]) ?? []
    const rows = list.slice(-15).reverse().map(x =>
      `${new Date(x.at).toLocaleTimeString()} ${x.blocked ? 'BLOQUEO' : 'aviso  '} ${x.rule} (${x.sev}) ${x.tool}: ${x.what}`)
    const miss = await missing($)
    const tob = miss.length ? ['', `Recomendado: skills de Trail of Bits para revisar el código (faltan ${miss.length}):`, ...installLines(miss)] : []
    return { text: [`guard · modo ${mode}${allowed.length ? ` · permitidas: ${allowed.join(', ')}` : ''}`, ...(rows.length ? rows : ['Sin eventos.']), ...tob, '', HELP].join('\n') }
  })

  // Revisión registrada al usar la skill o el comando de Trail of Bits (o /security-review).
  on('command.run', async ($, e, next) => {
    if (isReview(e.command)) await save($, 'pending', false)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ev = e as any
    const tool = String(ev.tool ?? '')
    if (tool === 'Skill' && isReview(String(ev.skill ?? ''))) await save($, 'pending', false)
    const cmd = tool === 'Bash' || tool === 'PowerShell' ? String(ev.command ?? '') : ''
    let hit: Hit | undefined = check(tool, ev)
    if (!hit && cmd && isCommit(cmd) && (await $.store.get('pending'))) hit = NO_REVIEW
    if (!hit) {
      const r = await next(e)
      if (r.deny !== undefined) return r
      if (isEdit(tool)) await save($, 'pending', true)
      if (cmd && isCommit(cmd) && !r.isError) await save($, 'pending', false)
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
      void $.ui.open({ id: PANE, title: 'Guard' })
      $.ui.toast(`🛡 guard bloqueó ${tool}: ${hit.why}`)
      return { deny: `guard: bloqueado (${hit.rule}: ${hit.why}). Si el usuario lo quiere de verdad, que lo ejecute él o use /guard permitir ${hit.rule}.${fix}` }
    }
    $.ui.toast(`🛡 guard: ${hit.why} (${tool})`)
    const r = await next(e)
    if (r.deny !== undefined) return r
    if (cmd && isCommit(cmd) && !r.isError) await save($, 'pending', false)
    return { ...r, context: [...(r.context ?? []), `guard: aviso ${hit.rule} (${hit.why}). ${fix || 'Confirma que el usuario lo pidió; si no, revierte.'}`] }
  // Si el guard falla, deja pasar (no bloquea el trabajo por un bug propio); el fallo queda en el log de debug.
  }).catch(($, e, next) => next(e))
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const { mode, allowed } = await cfg($)
    const list = ((await $.store.get('log')) as Entry[]) ?? []
    const pending = Boolean(await $.store.get('pending'))
    const miss = (await $.store.get('hideTob')) ? [] : await missing($)
    const b = list.filter(x => x.blocked).length
    return (
      <Box flexDirection="column">
        <Text bold>🛡 modo {mode} · {b} bloqueos · {list.length - b} avisos</Text>
        <Box>
          <Button key="m-avisar" variant={mode === 'avisar' ? 'primary' : undefined} onPress={() => void save($, 'mode', 'avisar')}>Avisar</Button>
          <Button key="m-bloquear" variant={mode === 'bloquear' ? 'primary' : undefined} onPress={() => void save($, 'mode', 'bloquear')}>Bloquear</Button>
          <Button key="clear" dimColor onPress={() => void save($, 'log', []).then(() => $.ui.status(undefined))}>Limpiar</Button>
        </Box>
        <Text color={pending ? 'yellow' : 'green'}>{pending ? '● cambios sin revisar: el próximo commit pedirá guard-review' : '✓ sin cambios pendientes de revisión'}</Text>
        {allowed.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Reglas permitidas</Text>
            {allowed.map(r => (
              <Box key={`a-${r}`}>
                <Text>  {r} </Text>
                <Button key={`q-${r}`} dimColor onPress={() => void save($, 'allowed', allowed.filter(x => x !== r))}>Reactivar</Button>
              </Box>
            ))}
          </Box>
        )}
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Bitácora</Text>
          {list.length === 0 && <Text dimColor>Sin eventos todavía.</Text>}
          {list.slice(-20).reverse().map((x, i) => (
            <Box key={`l-${x.at}-${i}`} flexDirection="column">
              <Box>
                <Text color={x.blocked ? 'red' : 'yellow'}>{x.blocked ? '✗ bloqueo' : '! aviso'} </Text>
                <Text bold>{x.rule}</Text>
                <Text dimColor> · {x.tool} · {new Date(x.at).toLocaleTimeString()} </Text>
                {!allowed.includes(x.rule) && (
                  <Button key={`p-${x.at}-${i}`} dimColor onPress={() => void save($, 'allowed', [...new Set([...allowed, x.rule])])}>Permitir regla</Button>
                )}
              </Box>
              <Text dimColor>  {x.why}: {x.what}</Text>
            </Box>
          ))}
        </Box>
        {miss.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Recomendado: Trail of Bits ({miss.length} faltan)</Text>
            {installLines(miss).map(l => <Text key={l} color="cyan">  {l}</Text>)}
            <Button key="hide" dimColor onPress={() => void save($, 'hideTob', true)}>Ocultar</Button>
          </Box>
        )}
      </Box>
    )
  })
}
