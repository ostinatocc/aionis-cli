#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

export type AionisProvider = "none" | "openai" | "dashscope" | "minimax" | string;
export type AionisQuickstart = "sdk" | "http" | "multi-agent" | "none";
export type SkillCandidateReviewStatus = "pending_review" | "promoted" | "rejected" | "all";
export type SkillCandidateAction = "list" | "promote" | "reject" | "materialize";

export type SetupOptions = {
  dir: string;
  createPackage: string;
  repo: string | null;
  branch: string | null;
  provider: AionisProvider;
  apiKey: string | null;
  quickstart: AionisQuickstart;
  withAifs: boolean;
  withZvecAnn: boolean;
  zvecPath: string | null;
  withClaudeCode: boolean;
  claudeCodeDir: string | null;
  claudeCodeBaseUrl: string;
  claudeCodeScopeFrom: "workspace" | "git" | "cwd" | "none";
  claudeCodeMcpName: string;
  claudeCodeSkipMcp: boolean;
  skipInstall: boolean;
  skipQuickstart: boolean;
  yes: boolean;
  dryRun: boolean;
};

export type SetupPlan = {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  redactedEnv: Record<string, string>;
};

export type SkillCandidateOptions = {
  action: SkillCandidateAction;
  candidateId: string | null;
  runtimeUrl: string;
  apiKey: string | null;
  tenantId: string | null;
  scope: string | null;
  status: SkillCandidateReviewStatus;
  limit: number;
  reviewerId: string | null;
  reason: string | null;
  commit: boolean;
  json: boolean;
};

export type AionisParsedCommand =
  | { command: "setup"; options: SetupOptions }
  | { command: "skills"; options: SkillCandidateOptions };

const DEFAULT_DIR = ".aionis-runtime";
const DEFAULT_CREATE_PACKAGE = "@aionis/create@latest";
const DEFAULT_CLAUDE_CODE_BASE_URL = "http://127.0.0.1:3101";
const DEFAULT_RUNTIME_URL = "http://127.0.0.1:3001";

function usage(): string {
  return `Usage:
  npx aionis setup [dir] [options]
  npx aionis skills candidates [options]
  npx aionis skills promote <candidate-id> [options]
  npx aionis skills reject <candidate-id> [options]
  npx aionis skills materialize <candidate-id> [--commit] [options]

Installs a local Aionis Runtime first. SDK, HTTP, MCP, AIFS, and native
plugins connect to that Runtime after it is installed.

Options:
  --dir <path>              Install directory. Defaults to ./.aionis-runtime.
  --provider <name>         Embedding provider: openai, dashscope, minimax, none, or custom. Defaults to detected env or openai.
  --quickstart <name>       Advanced: run an optional SDK, HTTP, or multi-agent verification flow after install. Defaults to none.
  --repo <url>              Runtime git repo passed to @aionis/create.
  --branch <name>           Runtime git branch or tag passed to @aionis/create.
  --with-aifs               Include @aionis/aifs file-surface setup commands.
  --with-zvec-ann           Enable optional Zvec ANN candidate index in the Runtime.
  --zvec-path <path>        Optional Zvec index path passed to @aionis/create.
  --with-claude-code        Install Claude Code lifecycle hooks.
  --claude-code-dir <path>  Directory used as Claude Code onboarding cwd. Defaults to current directory.
  --claude-code-base-url <url>
                            Runtime URL used by Claude Code hooks. Defaults to ${DEFAULT_CLAUDE_CODE_BASE_URL}.
  --claude-code-scope-from <workspace|git|cwd|none>
                            Scope strategy for Claude Code hooks. Defaults to workspace.
  --claude-code-mcp-name <name>
                            Claude MCP server name. Defaults to aionis-local.
  --claude-code-skip-mcp    Install hooks without running claude mcp add.
  --skip-install            Clone and write env, but do not run npm install.
  --skip-quickstart         Do not run the selected quickstart after install.
  --create-package <spec>   Installer package spec. Defaults to ${DEFAULT_CREATE_PACKAGE}.
  --yes                     Use defaults and environment values; do not prompt.
  --dry-run                 Print the redacted install plan without running it.
  -h, --help                Show help.

Skills operator options:
  --runtime-url <url>       Runtime URL. Defaults to AIONIS_URL, AIONIS_BASE_URL,
                            AIONIS_RUNTIME_URL, or ${DEFAULT_RUNTIME_URL}.
  --api-key <key>           Runtime API key. Defaults to AIONIS_API_KEY.
  --tenant-id <id>          Tenant passed to Runtime product routes.
  --scope <scope>           Scope passed to Runtime product routes.
  --status <status>         Candidate list status: pending_review, promoted,
                            rejected, or all. Defaults to pending_review.
  --limit <n>               Candidate list limit. Defaults to 20.
  --reviewer-id <id>        Reviewer id for promote/reject.
  --reason <text>           Review reason for promote/reject.
  --commit                  After materialize, explicitly submit the returned
                            recommended_observe_payload to /v1/observe.
  --json                    Print raw JSON response.

Common commands:
  npx aionis setup
  npx aionis setup --with-claude-code
  npx aionis skills candidates
  npx aionis skills promote skillcand_... --reason "verified reusable trace"
  npx aionis skills materialize skillcand_...
  npx aionis skills materialize skillcand_... --commit
  OPENAI_API_KEY=... npx aionis setup --provider openai --yes
  DASHSCOPE_API_KEY=... npx aionis setup --provider dashscope --yes
  MINIMAX_API_KEY=... npx aionis setup --provider minimax --yes
`;
}

function readFlagValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value`);
  return value;
}

export function providerEnvKey(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "none") return "";
  if (normalized === "openai") return "OPENAI_API_KEY";
  if (normalized === "dashscope") return "DASHSCOPE_API_KEY";
  if (normalized === "minimax") return "MINIMAX_API_KEY";
  return `${normalized.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
}

export function assertProviderKeyConfigured(options: SetupOptions): void {
  const providerKey = providerEnvKey(options.provider);
  if (!providerKey || options.apiKey?.trim()) return;
  throw new Error(
    [
      `EMBEDDING_PROVIDER=${options.provider} requires ${providerKey}.`,
      `Run ${providerKey}=... npx aionis setup --provider ${options.provider} --yes`,
      "or run npx aionis setup and paste the key when prompted.",
    ].join(" "),
  );
}

export function defaultProvider(env: NodeJS.ProcessEnv = process.env): AionisProvider {
  const explicit = env.EMBEDDING_PROVIDER?.trim();
  if (explicit) return explicit;
  if (env.OPENAI_API_KEY?.trim()) return "openai";
  if (env.DASHSCOPE_API_KEY?.trim()) return "dashscope";
  if (env.MINIMAX_API_KEY?.trim()) return "minimax";
  return "openai";
}

function parseQuickstart(value: string): AionisQuickstart {
  if (value === "sdk" || value === "http" || value === "multi-agent" || value === "none") {
    return value;
  }
  throw new Error(`Unsupported quickstart "${value}". Use sdk, http, multi-agent, or none.`);
}

function parseClaudeCodeScopeFrom(value: string): SetupOptions["claudeCodeScopeFrom"] {
  if (value === "workspace" || value === "git" || value === "cwd" || value === "none") return value;
  throw new Error(`Unsupported Claude Code scope source "${value}". Use workspace, git, cwd, or none.`);
}

function defaultRuntimeUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.AIONIS_URL?.trim()
    || env.AIONIS_BASE_URL?.trim()
    || env.AIONIS_RUNTIME_URL?.trim()
    || DEFAULT_RUNTIME_URL;
}

function parseSkillCandidateReviewStatus(value: string): SkillCandidateReviewStatus {
  if (value === "pending_review" || value === "promoted" || value === "rejected" || value === "all") return value;
  throw new Error(`Unsupported candidate status "${value}". Use pending_review, promoted, rejected, or all.`);
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} requires a positive integer`);
  return parsed;
}

function requiredCandidateId(value: string | undefined, action: string): string {
  if (!value || value.startsWith("-")) throw new Error(`aionis skills ${action} requires a candidate id`);
  return value;
}

export function parseSkillCandidateArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): SkillCandidateOptions {
  const [rawAction = "candidates", ...rest] = argv;
  if (rawAction === "-h" || rawAction === "--help") {
    process.stdout.write(usage());
    process.exit(0);
  }
  const action: SkillCandidateAction =
    rawAction === "candidates" || rawAction === "list" ? "list"
      : rawAction === "promote" ? "promote"
        : rawAction === "reject" ? "reject"
          : rawAction === "materialize" ? "materialize"
            : (() => {
              throw new Error(`Unknown skills command "${rawAction}". Use candidates, promote, reject, or materialize.`);
            })();

  let candidateId: string | null = null;
  let runtimeUrl = defaultRuntimeUrl(env);
  let apiKey: string | null = env.AIONIS_API_KEY?.trim() || null;
  let tenantId: string | null = null;
  let scope: string | null = null;
  let status: SkillCandidateReviewStatus = "pending_review";
  let limit = 20;
  let reviewerId: string | null = null;
  let reason: string | null = null;
  let commit = false;
  let json = false;
  let startIndex = 0;

  if (action !== "list") {
    candidateId = requiredCandidateId(rest[0], action);
    startIndex = 1;
  }

  for (let i = startIndex; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "-h" || arg === "--help") {
      process.stdout.write(usage());
      process.exit(0);
    }
    if (arg === "--runtime-url" || arg === "--base-url") {
      runtimeUrl = readFlagValue(rest, i, arg);
      i += 1;
      continue;
    }
    if (arg === "--api-key") {
      apiKey = readFlagValue(rest, i, arg);
      i += 1;
      continue;
    }
    if (arg === "--tenant-id") {
      tenantId = readFlagValue(rest, i, arg);
      i += 1;
      continue;
    }
    if (arg === "--scope") {
      scope = readFlagValue(rest, i, arg);
      i += 1;
      continue;
    }
    if (arg === "--status") {
      status = parseSkillCandidateReviewStatus(readFlagValue(rest, i, arg));
      i += 1;
      continue;
    }
    if (arg === "--limit") {
      limit = parsePositiveInteger(readFlagValue(rest, i, arg), arg);
      i += 1;
      continue;
    }
    if (arg === "--reviewer-id") {
      reviewerId = readFlagValue(rest, i, arg);
      i += 1;
      continue;
    }
    if (arg === "--reason") {
      reason = readFlagValue(rest, i, arg);
      i += 1;
      continue;
    }
    if (arg === "--commit") {
      commit = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`Unknown option "${arg}"`);
    throw new Error(`Unexpected positional argument "${arg}"`);
  }

  return {
    action,
    candidateId,
    runtimeUrl,
    apiKey,
    tenantId,
    scope,
    status,
    limit,
    reviewerId,
    reason,
    commit,
    json,
  };
}

export function parseAionisArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): AionisParsedCommand {
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    process.stdout.write(usage());
    process.exit(0);
  }

  const [command, ...rest] = argv;
  if (command === "skills") {
    return {
      command,
      options: parseSkillCandidateArgs(rest, env),
    };
  }
  if (command !== "setup") throw new Error(`Unknown command "${command}". Use: aionis setup or aionis skills`);

  let dir = DEFAULT_DIR;
  let createPackage = env.AIONIS_CREATE_PACKAGE?.trim() || DEFAULT_CREATE_PACKAGE;
  let repo: string | null = null;
  let branch: string | null = null;
  let provider = defaultProvider(env);
  let apiKey: string | null = null;
  let quickstart: AionisQuickstart = "none";
  let withAifs = false;
  let withZvecAnn = false;
  let zvecPath: string | null = null;
  let withClaudeCode = false;
  let claudeCodeDir: string | null = null;
  let claudeCodeBaseUrl = env.AIONIS_CLAUDE_CODE_BASE_URL?.trim() || DEFAULT_CLAUDE_CODE_BASE_URL;
  let claudeCodeScopeFrom: SetupOptions["claudeCodeScopeFrom"] = parseClaudeCodeScopeFrom(
    env.AIONIS_CLAUDE_CODE_SCOPE_FROM?.trim() || "workspace",
  );
  let claudeCodeMcpName = env.AIONIS_CLAUDE_CODE_MCP_NAME?.trim() || "aionis-local";
  let claudeCodeSkipMcp = false;
  let skipInstall = false;
  let skipQuickstart = false;
  let yes = false;
  let dryRun = false;
  let positionalDirSet = false;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "-h" || arg === "--help") {
      process.stdout.write(usage());
      process.exit(0);
    }
    if (arg === "--dir") {
      dir = readFlagValue(rest, i, arg);
      i += 1;
      continue;
    }
    if (arg === "--create-package") {
      createPackage = readFlagValue(rest, i, arg);
      i += 1;
      continue;
    }
    if (arg === "--repo") {
      repo = readFlagValue(rest, i, arg);
      i += 1;
      continue;
    }
    if (arg === "--branch") {
      branch = readFlagValue(rest, i, arg);
      i += 1;
      continue;
    }
    if (arg === "--provider") {
      provider = readFlagValue(rest, i, arg);
      i += 1;
      continue;
    }
    if (arg === "--quickstart") {
      quickstart = parseQuickstart(readFlagValue(rest, i, arg));
      skipQuickstart = quickstart === "none";
      i += 1;
      continue;
    }
    if (arg === "--with-aifs") {
      withAifs = true;
      continue;
    }
    if (arg === "--with-zvec-ann") {
      withZvecAnn = true;
      continue;
    }
    if (arg === "--zvec-path") {
      zvecPath = readFlagValue(rest, i, arg);
      withZvecAnn = true;
      i += 1;
      continue;
    }
    if (arg === "--with-claude-code") {
      withClaudeCode = true;
      continue;
    }
    if (arg === "--claude-code-dir") {
      claudeCodeDir = readFlagValue(rest, i, arg);
      i += 1;
      continue;
    }
    if (arg === "--claude-code-base-url") {
      claudeCodeBaseUrl = readFlagValue(rest, i, arg);
      i += 1;
      continue;
    }
    if (arg === "--claude-code-scope-from") {
      claudeCodeScopeFrom = parseClaudeCodeScopeFrom(readFlagValue(rest, i, arg));
      i += 1;
      continue;
    }
    if (arg === "--claude-code-mcp-name") {
      claudeCodeMcpName = readFlagValue(rest, i, arg);
      i += 1;
      continue;
    }
    if (arg === "--claude-code-skip-mcp") {
      claudeCodeSkipMcp = true;
      continue;
    }
    if (arg === "--skip-install") {
      skipInstall = true;
      continue;
    }
    if (arg === "--skip-quickstart") {
      skipQuickstart = true;
      continue;
    }
    if (arg === "--yes") {
      yes = true;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`Unknown option "${arg}"`);
    if (positionalDirSet) throw new Error(`Unexpected positional argument "${arg}"`);
    dir = arg;
    positionalDirSet = true;
  }

  const providerKey = providerEnvKey(provider);
  if (providerKey) apiKey = env[providerKey]?.trim() || null;

  return {
    command: "setup",
    options: {
      dir,
      createPackage,
      repo,
      branch,
      provider,
      apiKey,
      quickstart,
      withAifs,
      withZvecAnn,
      zvecPath,
      withClaudeCode,
      claudeCodeDir,
      claudeCodeBaseUrl,
      claudeCodeScopeFrom,
      claudeCodeMcpName,
      claudeCodeSkipMcp,
      skipInstall,
      skipQuickstart,
      yes,
      dryRun,
    },
  };
}

function isYes(value: string): boolean {
  return value.trim().toLowerCase() === "y" || value.trim().toLowerCase() === "yes";
}

function isNo(value: string): boolean {
  return value.trim().toLowerCase() === "n" || value.trim().toLowerCase() === "no";
}

async function askText(rl: readline.Interface, question: string, defaultValue: string): Promise<string> {
  const answer = (await rl.question(`${question} (${defaultValue}): `)).trim();
  return answer || defaultValue;
}

async function askBoolean(rl: readline.Interface, question: string, defaultValue: boolean): Promise<boolean> {
  const suffix = defaultValue ? "Y/n" : "y/N";
  const answer = (await rl.question(`${question} (${suffix}): `)).trim();
  if (!answer) return defaultValue;
  if (isYes(answer)) return true;
  if (isNo(answer)) return false;
  throw new Error(`Expected yes or no for: ${question}`);
}

export async function askHidden(question: string, stdin = process.stdin, stdout = process.stdout): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("Hidden API key input requires an interactive terminal. Set the provider key in the environment for non-interactive setup.");
  }

  stdout.write(question);
  stdin.resume();
  stdin.setEncoding("utf8");
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);

  return await new Promise<string>((resolve, reject) => {
    let value = "";
    let settled = false;

    const cleanup = () => {
      stdin.off("data", onData);
      stdin.off("error", onError);
      if (stdin.isTTY && typeof stdin.setRawMode === "function") stdin.setRawMode(wasRaw);
    };

    const finish = (nextValue: string) => {
      if (settled) return;
      settled = true;
      stdout.write("\n");
      cleanup();
      resolve(nextValue);
    };

    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const onError = (err: Error) => fail(err);
    const onData = (chunk: Buffer | string) => {
      for (const char of String(chunk)) {
        if (char === "\u0003") {
          fail(new Error("Interrupted"));
          return;
        }
        if (char === "\r" || char === "\n") {
          finish(value);
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };

    stdin.on("data", onData);
    stdin.once("error", onError);
  });
}

export async function promptForSetupOptions(options: SetupOptions): Promise<SetupOptions> {
  if (options.yes) return options;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive setup requires a TTY. Use --yes plus environment variables for non-interactive setup.");
  }

  process.stdout.write("Aionis setup\n");
  process.stdout.write("This will install a local Aionis Runtime and write its .env for you.\n");
  process.stdout.write("Press Enter to accept defaults. Aionis is installed for real Agent use; optional verification flows are advanced commands.\n\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const next: SetupOptions = { ...options };
    next.dir = await askText(rl, "Install directory", next.dir);
    next.provider = await askText(rl, "Embedding provider [openai/dashscope/minimax/none]", next.provider);
    next.withClaudeCode = await askBoolean(rl, "Install Claude Code hooks", next.withClaudeCode);
    if (next.withClaudeCode) {
      next.claudeCodeBaseUrl = await askText(rl, "Claude Code Runtime URL", next.claudeCodeBaseUrl);
    }
    next.withAifs = await askBoolean(rl, "Show AIFS file-surface setup commands", next.withAifs);
    next.withZvecAnn = await askBoolean(rl, "Enable Zvec ANN candidate index", next.withZvecAnn);
    if (next.withZvecAnn && next.zvecPath) {
      next.zvecPath = await askText(rl, "Zvec index path", next.zvecPath);
    }
    next.quickstart = "none";
    next.skipQuickstart = true;

    const providerKey = providerEnvKey(next.provider);
    if (providerKey && !next.apiKey) {
      rl.pause();
      const value = (await askHidden(`${providerKey} (hidden): `)).trim();
      rl.resume();
      next.apiKey = value || null;
      assertProviderKeyConfigured(next);
    }

    process.stdout.write("\n");
    process.stdout.write(formatSetupPlan(createSetupPlan(next)));
    const proceed = await askBoolean(rl, "Proceed with install", true);
    if (!proceed) throw new Error("Setup cancelled");
    return next;
  } finally {
    rl.close();
  }
}

export function createAionisCreateArgs(options: SetupOptions): string[] {
  const args = ["create-aionis", options.dir, "--provider", options.provider, "--quickstart", options.quickstart];
  if (options.repo) args.push("--repo", options.repo);
  if (options.branch) args.push("--branch", options.branch);
  if (options.withAifs) args.push("--with-aifs");
  if (options.withZvecAnn) {
    args.push("--with-zvec-ann");
    if (options.zvecPath) args.push("--zvec-path", options.zvecPath);
  }
  if (options.withClaudeCode) {
    args.push("--with-claude-code", "--claude-code-base-url", options.claudeCodeBaseUrl);
    if (options.claudeCodeDir) args.push("--claude-code-dir", options.claudeCodeDir);
    args.push("--claude-code-scope-from", options.claudeCodeScopeFrom);
    args.push("--claude-code-mcp-name", options.claudeCodeMcpName);
    if (options.claudeCodeSkipMcp) args.push("--claude-code-skip-mcp");
  }
  if (options.skipInstall) args.push("--skip-install");
  if (options.skipQuickstart) args.push("--skip-quickstart");
  return args;
}

export function createSetupPlan(options: SetupOptions, env: NodeJS.ProcessEnv = process.env): SetupPlan {
  assertProviderKeyConfigured(options);
  const providerKey = providerEnvKey(options.provider);
  const nextEnv: NodeJS.ProcessEnv = { ...env };
  const redactedEnv: Record<string, string> = {};
  if (providerKey && options.apiKey) {
    nextEnv[providerKey] = options.apiKey;
    redactedEnv[providerKey] = "<hidden>";
  }
  nextEnv.EMBEDDING_PROVIDER = options.provider;
  redactedEnv.EMBEDDING_PROVIDER = options.provider;

  return {
    command: "npm",
    args: [
      "exec",
      "--yes",
      "--package",
      options.createPackage,
      "--",
      ...createAionisCreateArgs(options),
    ],
    env: nextEnv,
    redactedEnv,
  };
}

export function formatSetupPlan(plan: SetupPlan): string {
  const envLines = Object.entries(plan.redactedEnv)
    .map(([key, value]) => `  ${key}=${value}`)
    .join("\n");
  return [
    "Install plan:",
    envLines ? `Environment:\n${envLines}` : "Environment: no provider key",
    `Command: ${plan.command} ${plan.args.join(" ")}`,
    "",
  ].join("\n");
}

function runPlan(plan: SetupPlan): void {
  const result = spawnSync(plan.command, plan.args, {
    env: plan.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${plan.command} ${plan.args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : [];
}

function normalizeRuntimeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Runtime URL is required");
  return trimmed.replace(/\/+$/, "");
}

function candidateBody(options: SkillCandidateOptions): Record<string, unknown> {
  return compactObject({
    tenant_id: options.tenantId,
    scope: options.scope,
    reviewer_id: options.reviewerId,
    reason: options.reason,
  });
}

export function createSkillCandidateRuntimeRequest(options: SkillCandidateOptions): {
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
} {
  if (options.action === "list") {
    const params = new URLSearchParams({
      status: options.status,
      limit: String(options.limit),
    });
    if (options.tenantId) params.set("tenant_id", options.tenantId);
    if (options.scope) params.set("scope", options.scope);
    return {
      method: "GET",
      path: `/v1/skills/candidates?${params.toString()}`,
    };
  }
  if (!options.candidateId) throw new Error(`aionis skills ${options.action} requires a candidate id`);
  const id = encodeURIComponent(options.candidateId);
  if (options.action === "promote" || options.action === "reject") {
    return {
      method: "POST",
      path: `/v1/skills/candidates/${id}/${options.action}`,
      body: candidateBody(options),
    };
  }
  return {
    method: "POST",
    path: `/v1/skills/candidates/${id}/materialize`,
    body: compactObject({
      tenant_id: options.tenantId,
      scope: options.scope,
    }),
  };
}

async function runtimeJsonRequest<T = unknown>(
  options: SkillCandidateOptions,
  request: { method: "GET" | "POST"; path: string; body?: Record<string, unknown> },
  fetchImpl: FetchLike,
): Promise<T> {
  const headers: Record<string, string> = {
    accept: "application/json",
  };
  if (request.method === "POST") headers["content-type"] = "application/json";
  if (options.apiKey) {
    headers["x-api-key"] = options.apiKey;
    headers.authorization = `Bearer ${options.apiKey}`;
  }
  const response = await fetchImpl(`${normalizeRuntimeUrl(options.runtimeUrl)}${request.path}`, {
    method: request.method,
    headers,
    ...(request.method === "POST" ? { body: JSON.stringify(request.body ?? {}) } : {}),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const record = asRecord(payload);
    const message = stringValue(record?.message) ?? stringValue(record?.error) ?? response.statusText;
    throw new Error(`Runtime ${request.method} ${request.path} failed (${response.status}): ${message}`);
  }
  return payload as T;
}

function formatCandidateRow(value: unknown): string {
  const row = asRecord(value) ?? {};
  const candidateId = stringValue(row.candidate_id) ?? "unknown";
  const status = stringValue(row.review_status) ?? "unknown";
  const skillName = stringValue(row.skill_name) ?? stringValue(asRecord(row.candidate)?.skill_name) ?? "Untitled skill candidate";
  const label = stringValue(row.label) ?? "unknown";
  const promotionStatus = stringValue(row.promotion_status) ?? "unknown";
  const exportReady = row.export_ready === true ? "yes" : row.export_ready === false ? "no" : "unknown";
  const reason = stringValue(row.reason);
  return [
    `- ${candidateId} [${status}] ${skillName}`,
    `  label=${label} export_ready=${exportReady} promotion=${promotionStatus}`,
    ...(reason ? [`  reason=${reason}`] : []),
  ].join("\n");
}

function formatCandidateList(result: unknown): string {
  const record = asRecord(result) ?? {};
  const candidates = Array.isArray(record.candidates) ? record.candidates : [];
  if (candidates.length === 0) return "No trace-derived skill candidates found.\n";
  return [
    `Trace-derived skill candidates (${candidates.length})`,
    ...candidates.map(formatCandidateRow),
    "",
  ].join("\n");
}

function formatReviewResult(action: "promote" | "reject", result: unknown): string {
  const record = asRecord(result) ?? {};
  const row = Array.isArray(record.candidates) ? record.candidates[0] : null;
  const candidate = asRecord(row);
  const candidateId = stringValue(candidate?.candidate_id) ?? "unknown";
  const status = stringValue(candidate?.review_status) ?? (action === "promote" ? "promoted" : "rejected");
  const mutation = asRecord(record.safety)?.memory_runtime_mutation === false ? "false" : "unknown";
  return [
    `Candidate ${candidateId} ${status}.`,
    `memory_runtime_mutation=${mutation}`,
    "",
  ].join("\n");
}

function formatMaterializeResult(result: unknown, committed: boolean): string {
  const record = asRecord(result) ?? {};
  const materialized = asRecord(record.materialized) ?? record;
  const draft = asRecord(materialized.draft);
  const observe = asRecord(record.observe);
  const title = stringValue(draft?.title) ?? "Untitled procedure draft";
  const candidateId = stringValue(materialized.candidate_id) ?? stringValue(draft?.source_candidate_id) ?? "unknown";
  const steps = stringList(draft?.procedure_steps);
  const checks = stringList(draft?.acceptance_checks);
  const lines = [
    "Trace-derived procedure draft",
    `Candidate: ${candidateId}`,
    `Title: ${title}`,
    "requires_observe_commit=true",
  ];
  if (steps.length > 0) {
    lines.push("Steps:");
    steps.forEach((step, index) => lines.push(`  ${index + 1}. ${step}`));
  }
  if (checks.length > 0) {
    lines.push("Acceptance checks:");
    checks.forEach((check) => lines.push(`  - ${check}`));
  }
  if (committed) {
    const observed = asRecord(observe?.observed);
    lines.push("Observe commit:");
    lines.push(`  memory_written=${observed?.memory_written === true ? "yes" : "unknown"}`);
    lines.push(`  execution_memory_count=${observed?.execution_memory_count ?? "unknown"}`);
  } else {
    lines.push("Not committed. Re-run with --commit to explicitly submit recommended_observe_payload to /v1/observe.");
  }
  lines.push("");
  return lines.join("\n");
}

function formatSkillCandidateOutput(options: SkillCandidateOptions, result: unknown): string {
  if (options.action === "list") return formatCandidateList(result);
  if (options.action === "promote" || options.action === "reject") return formatReviewResult(options.action, result);
  return formatMaterializeResult(result, options.commit);
}

export async function runSkillCandidateCommand(
  options: SkillCandidateOptions,
  fetchImpl: FetchLike = fetch,
  stdout: Pick<NodeJS.WriteStream, "write"> = process.stdout,
): Promise<unknown> {
  const first = await runtimeJsonRequest(options, createSkillCandidateRuntimeRequest(options), fetchImpl);
  let result: unknown = first;
  if (options.action === "materialize" && options.commit) {
    const observePayload = asRecord(asRecord(first)?.recommended_observe_payload);
    if (!observePayload) throw new Error("Materialize response did not include recommended_observe_payload");
    const observe = await runtimeJsonRequest(options, {
      method: "POST",
      path: "/v1/observe",
      body: observePayload,
    }, fetchImpl);
    result = {
      materialized: first,
      observe,
    };
  }
  stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : formatSkillCandidateOutput(options, result));
  return result;
}

export function isCliEntrypoint(argvEntry: string | undefined, moduleUrl = import.meta.url): boolean {
  if (!argvEntry) return false;
  const modulePath = fileURLToPath(moduleUrl);
  try {
    return fs.realpathSync(argvEntry) === fs.realpathSync(modulePath);
  } catch {
    return path.resolve(argvEntry) === path.resolve(modulePath);
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseAionisArgs(argv);
  if (parsed.command === "skills") {
    await runSkillCandidateCommand(parsed.options);
    return;
  }
  const options = await promptForSetupOptions(parsed.options);
  assertProviderKeyConfigured(options);
  const plan = createSetupPlan(options);
  if (options.dryRun) {
    process.stdout.write(formatSetupPlan(plan));
    return;
  }
  runPlan(plan);
}

if (isCliEntrypoint(process.argv[1])) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
