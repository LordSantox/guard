# guard

[English](README.md) | **Español**

Mod para Claude Code que pone barandas a cada llamada a herramienta: avisa o bloquea comandos peligrosos, acceso a secretos y ediciones a la configuración de Claude. Reglas locales (regex), cero llamadas al modelo, con bitácora y comando `/guard`.

## Instalar

En una sesión de Claude Code:

```
/plugin install guard --marketplace LordSantox/guard
```

Responde `y` para añadir el marketplace y elige el alcance (usuario o proyecto).

Desde una terminal:

```bash
claude plugin install guard --marketplace LordSantox/guard
```

### Instalarlo pidiéndoselo a Claude

> Instala el mod de https://github.com/LordSantox/guard siguiendo las instrucciones de su README.

## Cómo funciona

Modo por defecto **avisar**: las reglas `high` dejan pasar la acción, muestran un aviso y le dejan a Claude una nota para que confirme que el usuario lo pidió. Las reglas `critical` **bloquean siempre**.

| Regla | Gravedad | Detecta |
|---|---|---|
| `rm-root`, `ps-rm-root` | critical | borrado recursivo de `/`, `~`, `$HOME`, `*`, `C:\` |
| `disk-wipe`, `fork-bomb` | critical | `mkfs`, `dd of=/dev/…`, `format C:`, fork bomb |
| `pipe-shell` | critical | `curl … \| sh`, `iwr … \| iex` |
| `exfil` | critical | `curl -d @archivo`, `env \| curl`, subidas |
| `self-config` | critical | Claude editando `.claude/settings*.json` o este mod |
| `force-push`, `git-destroy` | high | `git push --force`, `reset --hard`, `clean -fdx` |
| `sql-drop`, `chmod-777` | high | `DROP TABLE`, `TRUNCATE`, `chmod 777` |
| `opaque` | high | `base64 -d \| sh`, `-EncodedCommand`, `eval "$…"` |
| `remote-pkg` | high | `npm i https://…`, `pip install git+…` |
| `secret-file`, `secret-read` | high | `.env`, `id_rsa`, `~/.ssh`, `~/.aws`, `*.pem`, `.npmrc` |
| `secret-in-code` | high | escribir tokens tipo `ghp_…`, `sk-…`, `AKIA…`, claves privadas |

Normaliza antes de comparar: atrapa `r''m`, `\rm`, `X=rm; $X -rf /`, `bash -c "…"` y cadenas con `&&`. Deja pasar `rm -rf node_modules`, `.env.example` y `--force-with-lease`.

## Revisión antes de commit (con Trail of Bits)

guard no reinventa la auditoría: al iniciar la sesión revisa si están instaladas y, si faltan, muestra un aviso y los comandos de instalación en `/guard`. Se apoya en [trailofbits/skills](https://github.com/trailofbits/skills). Instala las recomendadas:

```
/plugin install differential-review --marketplace trailofbits/skills
/plugin install supply-chain-risk-auditor --marketplace trailofbits/skills
```

- Si Claude editó archivos, un `git commit`/`push` sin revisión de seguridad activa la regla `no-review` (high): avisa en modo avisar y bloquea en modo bloquear. guard trae su propia skill corta, `guard-review` (solo el diff, respuesta de ≤10 líneas), que se le pide a Claude correr; `differential-review`, `/diff-review` o `/security-review` también la liberan.
- Ante `npm install <paquete>`, `pip install <paquete>`, `cargo add` o `go get`, guard le indica a Claude usar `supply-chain-risk-auditor`.

## Comandos

```
/guard                    bitácora (últimos 15)
/guard avisar             modo avisar (por defecto)
/guard bloquear           modo bloquear: también bloquea las "high"
/guard permitir <regla>   desactiva una regla
/guard quitar <regla>     la vuelve a activar
/guard limpiar            borra la bitácora
/guard ocultar            deja de sugerir instalar Trail of Bits
```

## Límites

Es una capa de defensa, no un sandbox. Un regex se puede evadir (escribir un script y luego ejecutarlo, `python -c`, comillas raras). Úsalo junto con los permisos de Claude Code.

## Licencia

MIT
