# aionis

Product CLI for installing Aionis Runtime.

```bash
npx aionis setup
```

`aionis setup` guides the user through a local Runtime install, collects an
optional embedding provider key with hidden terminal input, writes the generated
Runtime `.env` through `@aionis/create`, and leaves the Runtime ready to start.
The local demo is optional and disabled by default.

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
```

Dry-run without installing:

```bash
npx aionis setup --provider openai --dry-run
```
