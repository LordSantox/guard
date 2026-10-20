---
name: guard-review
description: Short security review of the staged diff. Use ONLY when the guard mod asks for it before a git commit or push.
---

# guard-review

Review only what is about to be committed. Do not read the whole repo.

1. Run `git diff --cached` (or `git diff HEAD` if nothing is staged). If the diff is over ~400 lines, review only the changed hunks, file by file.
2. Check each item below. Report only real problems, with `file:line`:
   - **Secrets**: keys, tokens, passwords, private keys, `.env` content.
   - **Injection**: SQL/shell/HTML built by string concatenation with user input; `eval`, `exec`, `dangerouslySetInnerHTML`, `shell=True`.
   - **Input validation**: new endpoints, handlers or CLI args that trust input without checks; missing authz on new routes.
   - **Insecure defaults**: `debug=True`, CORS `*`, TLS verification off, permissive file modes.
   - **Tests weakened**: tests deleted, skipped, or assertions loosened to make them pass.
   - **Dependencies**: new packages; if `supply-chain-risk-auditor` is installed, use it for them.
3. Reply in at most 10 lines: `OK` or a list of findings (`high`/`low`). If any is `high`, fix it or ask the user before committing.

For a deeper audit, use Trail of Bits `differential-review` if installed.
