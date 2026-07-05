# aionis

Product CLI for installing and operating a local Aionis Runtime.

```bash
npx aionis setup
```

`aionis setup` is the recommended first entry point. It installs the Runtime,
collects a required embedding provider key with hidden terminal input when needed,
writes the generated Runtime `.env` through `@aionis/create`, and prints the
next commands for starting the Runtime and connecting SDK, HTTP, MCP, AIFS, or
native plugins.

Setup is for real Agent use. It installs the Runtime and integration surfaces
without running optional verification flows by default.

The top-level CLI does not duplicate installer logic. It delegates the actual
Runtime install to the published `@aionis/create` package internally, while
keeping `npx aionis setup` as the public product entry point.

API keys are passed to the installer process through environment variables, not
through command-line arguments, so they are not echoed into shell history or the
printed install plan.

For non-interactive installs, the matching provider key is required. Aionis
fails before cloning if `--yes` is used with a real provider and no provider key
is available.

Useful non-interactive runs:

```bash
OPENAI_API_KEY="sk-..." npx aionis setup .aionis-runtime --provider openai --yes
DASHSCOPE_API_KEY="sk-..." npx aionis setup .aionis-runtime --provider dashscope --yes
MINIMAX_API_KEY="sk-..." npx aionis setup .aionis-runtime --provider minimax --yes
OPENAI_API_KEY="sk-..." npx aionis setup --with-claude-code --provider openai --yes
MINIMAX_API_KEY="sk-..." npx aionis setup --with-zvec-ann --provider minimax --yes
```

Dry-run without installing:

```bash
npx aionis setup --provider openai --dry-run
```

## Runtime inspection

`aionis health`, `aionis boundary`, and `aionis doctor` are read-only operator
commands for checking a running Runtime without mutating memory.

```bash
# Check /health.
npx aionis health --runtime-url http://127.0.0.1:3001

# Inspect the Runtime boundary inventory.
npx aionis boundary

# Run both checks and print a compact operator summary.
npx aionis doctor
```

Useful options:

```bash
--runtime-url <url>   Defaults to AIONIS_URL, AIONIS_BASE_URL,
                      AIONIS_RUNTIME_URL, or http://127.0.0.1:3001
--api-key <key>       Defaults to AIONIS_API_KEY
--json                Print the raw Runtime response
```

## Trace-derived skill review

`aionis skills` is the operator entry point for reviewed trace-derived skill
candidates. It calls Runtime product APIs directly and keeps the safety boundary
explicit: materialize previews do not write memory, and only `--commit` submits
the returned `recommended_observe_payload` to `/v1/observe`.

```bash
# List pending review candidates.
npx aionis skills candidates --runtime-url http://127.0.0.1:3001

# Record review decisions.
npx aionis skills promote skillcand_... --reason "verified reusable trace"
npx aionis skills reject skillcand_... --reason "not enough repeated evidence"

# Preview the procedure memory draft. This does not mutate Runtime memory.
npx aionis skills materialize skillcand_...

# Explicitly commit the reviewed draft to Runtime memory.
npx aionis skills materialize skillcand_... --commit
```

Useful options:

```bash
--runtime-url <url>   Defaults to AIONIS_URL, AIONIS_BASE_URL,
                      AIONIS_RUNTIME_URL, or http://127.0.0.1:3001
--api-key <key>       Defaults to AIONIS_API_KEY
--tenant-id <id>
--scope <scope>
--status <pending_review|promoted|rejected|all>
--limit <n>
--json
```
