# aionis

Product CLI for installing a local Aionis Runtime.

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
