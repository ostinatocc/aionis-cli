import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import {
  askHidden,
  createAionisCreateArgs,
  createSetupPlan,
  defaultProvider,
  formatSetupPlan,
  parseAionisArgs,
  providerEnvKey,
} from "../src/index.ts";

class FakeTtyInput extends PassThrough {
  isTTY = true;
  isRaw = false;
  rawModes: boolean[] = [];

  setRawMode(mode: boolean): this {
    this.isRaw = mode;
    this.rawModes.push(mode);
    return this;
  }
}

class FakeTtyOutput extends Writable {
  isTTY = true;
  chunks: string[] = [];

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(String(chunk));
    callback();
  }

  text(): string {
    return this.chunks.join("");
  }
}

test("aionis setup parses a product default that installs a sidecar Runtime", () => {
  const { options } = parseAionisArgs(["setup"], {});
  assert.equal(options.dir, ".aionis-runtime");
  assert.equal(options.createPackage, "@aionis/create@latest");
  assert.equal(options.provider, "none");
  assert.equal(options.quickstart, "none");
  assert.equal(options.skipQuickstart, false);
  assert.equal(options.withClaudeCode, false);
  assert.equal(options.yes, false);
  assert.equal(options.dryRun, false);
});

test("aionis setup runs a local demo only when explicitly requested", () => {
  const { options } = parseAionisArgs(["setup", "--demo", "first-value", "--yes"], {});
  const plan = createSetupPlan(options, {});

  assert.equal(options.quickstart, "first-value");
  assert.equal(options.skipQuickstart, false);
  assert.deepEqual(plan.args.slice(-4), ["--provider", "none", "--quickstart", "first-value"]);
});

test("aionis setup supports explicit no-demo mode", () => {
  const { options } = parseAionisArgs(["setup", "--demo", "first-value", "--no-demo", "--yes"], {});
  const plan = createSetupPlan(options, {});

  assert.equal(options.quickstart, "none");
  assert.equal(options.skipQuickstart, true);
  assert.equal(plan.args.includes("--skip-quickstart"), true);
});

test("aionis setup hidden key input restores stdin for follow-up prompts", async () => {
  const input = new FakeTtyInput();
  const output = new FakeTtyOutput();
  const promise = askHidden("MINIMAX_API_KEY: ", input as unknown as typeof process.stdin, output as unknown as typeof process.stdout);

  input.write("sk-hidden\r");
  const value = await promise;

  assert.equal(value, "sk-hidden");
  assert.equal(input.isRaw, false);
  assert.deepEqual(input.rawModes, [true, false]);
  assert.equal(input.listenerCount("data"), 0);
  assert.equal(output.text(), "MINIMAX_API_KEY: \n");
});

test("aionis setup detects provider from environment", () => {
  assert.equal(defaultProvider({}), "none");
  assert.equal(defaultProvider({ OPENAI_API_KEY: "sk-openai" }), "openai");
  assert.equal(defaultProvider({ MINIMAX_API_KEY: "sk-minimax" }), "minimax");
  assert.equal(defaultProvider({ EMBEDDING_PROVIDER: "minimax", OPENAI_API_KEY: "sk-openai" }), "minimax");
});

test("aionis setup maps provider names to environment keys", () => {
  assert.equal(providerEnvKey("none"), "");
  assert.equal(providerEnvKey("openai"), "OPENAI_API_KEY");
  assert.equal(providerEnvKey("minimax"), "MINIMAX_API_KEY");
  assert.equal(providerEnvKey("custom provider"), "CUSTOM_PROVIDER_API_KEY");
});

test("aionis setup passes secrets through env, never command arguments", () => {
  const { options } = parseAionisArgs([
    "setup",
    "runtime",
    "--provider",
    "openai",
    "--demo",
    "sdk",
    "--yes",
  ], { OPENAI_API_KEY: "sk-secret" });
  const plan = createSetupPlan(options, {});

  assert.equal(plan.env.OPENAI_API_KEY, "sk-secret");
  assert.deepEqual(plan.redactedEnv, {
    EMBEDDING_PROVIDER: "openai",
    OPENAI_API_KEY: "<hidden>",
  });
  assert.equal(plan.command, "npm");
  assert.deepEqual(plan.args.slice(0, 6), ["exec", "--yes", "--package", "@aionis/create@latest", "--", "create-aionis"]);
  assert.equal(plan.args.includes("sk-secret"), false);
  assert.equal(plan.args.includes("--api-key"), false);
  assert.equal(formatSetupPlan(plan).includes("sk-secret"), false);
});

test("aionis setup builds create-aionis args for Claude Code without duplicating installer logic", () => {
  const { options } = parseAionisArgs([
    "setup",
    ".aionis-runtime",
    "--provider",
    "none",
    "--demo",
    "first-value",
    "--with-claude-code",
    "--claude-code-dir",
    "agent-project",
    "--claude-code-base-url",
    "http://127.0.0.1:3101",
    "--claude-code-scope-from",
    "workspace",
    "--claude-code-mcp-name",
    "aionis-local",
    "--claude-code-skip-mcp",
    "--yes",
  ], {});

  assert.deepEqual(createAionisCreateArgs(options), [
    "create-aionis",
    ".aionis-runtime",
    "--provider",
    "none",
    "--quickstart",
    "first-value",
    "--with-claude-code",
    "--claude-code-base-url",
    "http://127.0.0.1:3101",
    "--claude-code-dir",
    "agent-project",
    "--claude-code-scope-from",
    "workspace",
    "--claude-code-mcp-name",
    "aionis-local",
    "--claude-code-skip-mcp",
  ]);
});

test("aionis setup supports release overrides and dry-run", () => {
  const { options } = parseAionisArgs([
    "setup",
    "--create-package",
    "file:/tmp/aionis-create",
    "--repo",
    "https://example.test/Aionis.git",
    "--branch",
    "main",
    "--skip-install",
    "--skip-quickstart",
    "--dry-run",
    "--yes",
  ], {});
  const plan = createSetupPlan(options, {});

  assert.equal(options.dryRun, true);
  assert.deepEqual(plan.args, [
    "exec",
    "--yes",
    "--package",
    "file:/tmp/aionis-create",
    "--",
    "create-aionis",
    ".aionis-runtime",
    "--provider",
    "none",
    "--quickstart",
    "none",
    "--repo",
    "https://example.test/Aionis.git",
    "--branch",
    "main",
    "--skip-install",
    "--skip-quickstart",
  ]);
});
