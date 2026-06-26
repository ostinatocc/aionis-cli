# aionis

Product CLI for installing a local Aionis Runtime.

```bash
npx aionis setup
```

`aionis setup` is the recommended first entry point. It installs the Runtime,
collects an embedding provider key with hidden terminal input when needed,
writes the generated Runtime `.env` through `@aionis/create`, and prints the
next commands for starting the Runtime and connecting SDK, HTTP, MCP, AIFS, or
native plugins.

Setup is for real Agent use. It installs the Runtime and integration surfaces
without running optional verification flows by default.

The top-level CLI does not duplicate installer logic. It delegates the actual
Runtime install to the published `@aionis/create` package:

```bash
npm exec --yes --package @aionis/create@latest -- create-aionis ...
```

API keys are passed to the installer process through environment variables, not
through command-line arguments, so they are not echoed into shell history or the
printed install plan.

Useful non-interactive runs:

```bash
OPENAI_API_KEY="sk-..." npx aionis setup .aionis-runtime --provider openai --yes
MINIMAX_API_KEY="sk-..." npx aionis setup .aionis-runtime --provider minimax --yes
npx aionis setup --with-claude-code --yes
npx aionis setup --with-zvec-ann --yes
```

Dry-run without installing:

```bash
npx aionis setup --provider openai --dry-run
```
