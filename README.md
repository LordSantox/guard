# guard

**English** | [Español](README.es.md)

A Claude Code mod that puts guardrails on every tool call: it warns about or blocks dangerous commands, secret access and edits to Claude's own config. Local regex rules, zero model calls, with a log and a `/guard` command.

## Install

In a Claude Code session:

```
/plugin install guard --marketplace LordSantox/guard
```

Answer `y` to add the marketplace, then choose the scope (user or project).

From a terminal:

```bash
claude plugin install guard --marketplace LordSantox/guard
```

### Install by asking Claude

> Install the mod from https://github.com/LordSantox/guard following the instructions in its README.

## How it works

Default mode is **warn**: `high` rules let the action run, show a toast and add a note telling Claude to confirm the user asked for it. `critical` rules **always block**.

| Rule | Severity | Catches |
|---|---|---|
| `rm-root`, `ps-rm-root` | critical | recursive delete of `/`, `~`, `$HOME`, `*`, `C:\` |
| `disk-wipe`, `fork-bomb` | critical | `mkfs`, `dd of=/dev/…`, `format C:`, fork bomb |
| `pipe-shell` | critical | `curl … \| sh`, `iwr … \| iex` |
| `exfil` | critical | `curl -d @file`, `env \| curl`, uploads |
| `self-config` | critical | Claude editing `.claude/settings*.json` or this mod |
| `force-push`, `git-destroy` | high | `git push --force`, `reset --hard`, `clean -fdx` |
| `sql-drop`, `chmod-777` | high | `DROP TABLE`, `TRUNCATE`, `chmod 777` |
| `opaque` | high | `base64 -d \| sh`, `-EncodedCommand`, `eval "$…"` |
| `remote-pkg` | high | `npm i https://…`, `pip install git+…` |
| `secret-file`, `secret-read` | high | `.env`, `id_rsa`, `~/.ssh`, `~/.aws`, `*.pem`, `.npmrc` |
| `secret-in-code` | high | writing tokens like `ghp_…`, `sk-…`, `AKIA…`, private keys |

It normalizes before matching, so `r''m`, `\rm`, `X=rm; $X -rf /`, `bash -c "…"` and `a && b` chains are caught. `rm -rf node_modules`, `.env.example` and `--force-with-lease` are allowed.

## Review before commit (with Trail of Bits)

guard does not reinvent auditing: it relies on [trailofbits/skills](https://github.com/trailofbits/skills). Install the recommended ones:

```
/plugin install differential-review --marketplace trailofbits/skills
/plugin install supply-chain-risk-auditor --marketplace trailofbits/skills
```

- After Claude edits files, a `git commit`/`push` without a security review triggers rule `no-review` (high): warns in warn mode, blocks in block mode. Running `differential-review`, `/diff-review` or `/security-review` clears it.
- On `npm install <pkg>`, `pip install <pkg>`, `cargo add`, `go get`, guard tells Claude to run `supply-chain-risk-auditor`.

## Commands

```
/guard                    log (last 15)
/guard avisar             warn mode (default)
/guard bloquear           block mode: also blocks "high" rules
/guard permitir <rule>    disable a rule
/guard quitar <rule>      re-enable it
/guard limpiar            clear the log
```

The UI text is in Spanish.

## Limits

This is a defense layer, not a sandbox. Regex can be evaded (scripts written then executed, `python -c`, unusual quoting). Use it together with Claude Code's permissions.

## License

MIT
