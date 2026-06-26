# aionis

Product CLI for installing a local Aionis Runtime.

```bash
npx aionis setup
```

`aionis setup` is the recommended first entry point. It installs the Runtime,
collects an optional embedding provider key with hidden terminal input, writes
the generated Runtime `.env` through `@aionis/create`, and prints the next
commands for starting the Runtime and connecting SDK, HTTP, MCP, AIFS, or native
plugins. The local demo is optional and disabled by default.

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
npx aionis setup --yes
npx aionis setup --demo first-value --yes
OPENAI_API_KEY="sk-..." npx aionis setup .aionis-runtime --provider openai --demo sdk --yes
npx aionis setup --with-claude-code --yes
npx aionis setup --with-zvec-ann --yes
```

Dry-run without installing:

```bash
npx aionis setup --provider openai --dry-run
```
