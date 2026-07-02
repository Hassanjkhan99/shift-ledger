# Claude Code Skills

Custom skills for this project.

## design-evidence

**Extract design handoff artifacts, serve them locally, and generate GitHub evidence comments.**

### Quick start

```bash
/design-evidence --zip shadcnui\ Design\ System-handoff.zip --issue 27
```

### What it does

1. **Extracts** design files from a zip archive (HTML UI kits, components, tokens)
2. **Serves** them locally via a static HTTP server (python / npx)
3. **Screenshots** each screen (with fallbacks for headless tool timeouts)
4. **Generates** a GitHub-ready evidence comment with artifact inventory
5. **Posts** the comment to a GitHub issue (if `--issue` specified)
6. **Cleans up** the server and temp files when done

### Arguments

| Flag | Required | Description |
|---|---|---|
| `--zip <path>` | yes | Path to design handoff zip file |
| `--screens <files>` | no | Comma-separated HTML screens to serve (default: `manager.html,index.html,audit-export.html`) |
| `--issue <#>` | no | GitHub issue number to post evidence comment to |
| `--repo <owner/repo>` | no | GitHub repo (default: current repo inferred from git) |

### Examples

**Extract and serve locally (no GitHub posting):**
```bash
/design-evidence --zip design.zip
```

**Extract, serve, and post to issue:**
```bash
/design-evidence --zip design.zip --issue 27 --repo Hassanjkhan99/shift-ledger
```

**Custom screen selection:**
```bash
/design-evidence --zip design.zip --screens index.html,manager.html --issue 27
```

### Output

Creates:
- `docs/evidence/design-handoff-<timestamp>/` — extracted artifacts + COMMENT.md
- Local static server on port 5999 (stays running for manual inspection)
- GitHub comment with artifact inventory (if `--issue` specified)

### Dependencies

- `unzip` — to extract the zip
- `python3` or `python` or `npx` — to run a static server
- `gh` CLI — only if posting to GitHub (`--issue` flag)

### Known limitations

1. **Headless screenshot tool timeouts** — Babel-heavy React pages may timeout in preview tool. Skill notes the server URL instead, which you can manually screenshot or open in a browser.
2. **Interactive screenshots** — For complex interactive designs, open the local server URL in a browser and take screenshots manually.
3. **Single session** — The skill is designed for a single QA session. Re-run it for new evidence.

### Development

- Script: `.claude/skills/design-evidence.sh`
- Registration: `.claude/skills/design-evidence.json`
- This README: `.claude/skills/README.md`

To extend:
1. Add more screenshot fallback methods (currently: preview tool → note server URL)
2. Integrate with screenshot automation (Playwright, headless Chrome)
3. Add support for design file formats beyond HTML (Figma API, etc.)
