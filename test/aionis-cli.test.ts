import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import {
  askHidden,
  createAionisCreateArgs,
  createRuntimeInspectRequests,
  createSetupPlan,
  createSkillCandidateRuntimeRequest,
  defaultProvider,
  formatSetupPlan,
  parseAionisArgs,
  parseRuntimeInspectArgs,
  parseSkillCandidateArgs,
  providerEnvKey,
  runRuntimeInspectCommand,
  runSkillCandidateCommand,
  assertProviderKeyConfigured,
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

function captureStdout() {
  const chunks: string[] = [];
  return {
    stdout: {
      write(chunk: string | Uint8Array): boolean {
        chunks.push(String(chunk));
        return true;
      },
    },
    text: () => chunks.join(""),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function asRuntimeDoctorResult(value: unknown): { health: { ok?: boolean } } {
  return value as { health: { ok?: boolean } };
}

test("aionis setup parses a product default that installs a sidecar Runtime", () => {
  const { options } = parseAionisArgs(["setup"], {});
  assert.equal(options.dir, ".aionis-runtime");
  assert.equal(options.createPackage, "@aionis/create@latest");
  assert.equal(options.provider, "openai");
  assert.equal(options.quickstart, "none");
  assert.equal(options.skipQuickstart, false);
  assert.equal(options.withZvecAnn, false);
  assert.equal(options.zvecPath, null);
  assert.equal(options.withClaudeCode, false);
  assert.equal(options.yes, false);
  assert.equal(options.dryRun, false);
});

test("aionis setup runs an install verification flow only when explicitly requested", () => {
  const { options } = parseAionisArgs(["setup", "--quickstart", "sdk", "--yes"], { OPENAI_API_KEY: "sk-openai" });
  const plan = createSetupPlan(options, {});

  assert.equal(options.quickstart, "sdk");
  assert.equal(options.skipQuickstart, false);
  assert.deepEqual(plan.args.slice(-4), ["--provider", "openai", "--quickstart", "sdk"]);
});

test("aionis setup supports skipping a selected install verification flow", () => {
  const { options } = parseAionisArgs(["setup", "--quickstart", "sdk", "--skip-quickstart", "--yes"], { OPENAI_API_KEY: "sk-openai" });
  const plan = createSetupPlan(options, {});

  assert.equal(options.quickstart, "sdk");
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
  assert.equal(defaultProvider({}), "openai");
  assert.equal(defaultProvider({ OPENAI_API_KEY: "sk-openai" }), "openai");
  assert.equal(defaultProvider({ DASHSCOPE_API_KEY: "sk-dashscope" }), "dashscope");
  assert.equal(defaultProvider({ MINIMAX_API_KEY: "sk-minimax" }), "minimax");
  assert.equal(defaultProvider({ EMBEDDING_PROVIDER: "minimax", OPENAI_API_KEY: "sk-openai" }), "minimax");
  assert.equal(defaultProvider({ EMBEDDING_PROVIDER: "dashscope", OPENAI_API_KEY: "sk-openai" }), "dashscope");
});

test("aionis setup maps provider names to environment keys", () => {
  assert.equal(providerEnvKey("none"), "");
  assert.equal(providerEnvKey("openai"), "OPENAI_API_KEY");
  assert.equal(providerEnvKey("dashscope"), "DASHSCOPE_API_KEY");
  assert.equal(providerEnvKey("minimax"), "MINIMAX_API_KEY");
  assert.equal(providerEnvKey("custom provider"), "CUSTOM_PROVIDER_API_KEY");
});

test("aionis setup fails fast for real providers without an API key", () => {
  const { options } = parseAionisArgs(["setup", "--provider", "openai", "--yes"], {});

  assert.throws(
    () => assertProviderKeyConfigured(options),
    /EMBEDDING_PROVIDER=openai requires OPENAI_API_KEY/,
  );
  assert.throws(
    () => createSetupPlan(options, {}),
    /OPENAI_API_KEY=.*npx aionis setup --provider openai --yes/,
  );
});

test("aionis setup passes secrets through env, never command arguments", () => {
  const { options } = parseAionisArgs([
    "setup",
    "runtime",
    "--provider",
    "openai",
    "--quickstart",
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
    "--quickstart",
    "http",
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
    "http",
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

test("aionis setup passes optional Zvec ANN setup through to @aionis/create", () => {
  const { options } = parseAionisArgs([
    "setup",
    ".aionis-runtime",
    "--provider",
    "minimax",
    "--with-zvec-ann",
    "--zvec-path",
    ".aionis/zvec-ann",
    "--yes",
  ], {});
  options.apiKey = "sk-minimax";

  assert.equal(options.withZvecAnn, true);
  assert.equal(options.zvecPath, ".aionis/zvec-ann");
  assert.deepEqual(createAionisCreateArgs(options), [
    "create-aionis",
    ".aionis-runtime",
    "--provider",
    "minimax",
    "--quickstart",
    "none",
    "--with-zvec-ann",
    "--zvec-path",
    ".aionis/zvec-ann",
  ]);
});

test("aionis setup supports release overrides and dry-run", () => {
  const { options } = parseAionisArgs([
    "setup",
    "--provider",
    "none",
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

test("aionis setup delegates final next steps to create-aionis", () => {
  const { options } = parseAionisArgs(["setup", ".aionis-runtime", "--with-claude-code", "--yes"], { OPENAI_API_KEY: "sk-openai" });
  const plan = createSetupPlan(options, {});

  assert.equal(plan.args.includes("create-aionis"), true);
  assert.equal(plan.args.includes("--with-claude-code"), true);
  assert.equal(plan.args.includes("--quickstart"), true);
  assert.equal(plan.args.includes("none"), true);
});

test("aionis runtime inspect parses health and boundary options", () => {
  const health = parseAionisArgs(["health", "--runtime-url", "http://runtime.local/", "--api-key", "sk-runtime"], {});

  assert.equal(health.command, "health");
  assert.equal(health.options.runtimeUrl, "http://runtime.local/");
  assert.equal(health.options.apiKey, "sk-runtime");
  assert.deepEqual(createRuntimeInspectRequests(health.options), [
    {
      method: "GET",
      path: "/health",
    },
  ]);

  const boundary = parseRuntimeInspectArgs("boundary", ["--json"], { AIONIS_URL: "http://runtime.local" });
  assert.equal(boundary.runtimeUrl, "http://runtime.local");
  assert.equal(boundary.json, true);
  assert.deepEqual(createRuntimeInspectRequests(boundary), [
    {
      method: "GET",
      path: "/v1/runtime/boundary-inventory",
    },
  ]);
});

test("aionis doctor reads health and boundary inventory", async () => {
  const options = parseRuntimeInspectArgs("doctor", [], {
    AIONIS_URL: "http://runtime.local",
  });
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const responses = [
    {
      ok: true,
      runtime: {
        edition: "lite",
        mode: "local",
        package_name: "aionis-runtime",
        package_version: "0.3.6",
      },
      storage: {
        backend: "sqlite",
      },
    },
    {
      surface_version: "runtime_boundary_inventory_response_v1",
      surface_semantics: {
        read_only: true,
        persistence_effect: "none",
        authority_effect: "none",
      },
      summary: {
        total_entries: 5,
        total_files: 3,
        authority_entries: 5,
        authority_producer_entries: 2,
      },
      files: ["src/kernel/learning-kernel.ts"],
    },
  ];
  const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init });
    return jsonResponse(responses.shift());
  };
  const output = captureStdout();

  const result = await runRuntimeInspectCommand(options, fetchImpl, output.stdout as unknown as typeof process.stdout);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "http://runtime.local/health");
  assert.equal(calls[1].url, "http://runtime.local/v1/runtime/boundary-inventory");
  assert.equal(asRuntimeDoctorResult(result).health.ok, true);
  assert.equal(output.text().includes("Aionis Runtime doctor"), true);
  assert.equal(output.text().includes("boundary=ok entries=5 files=3"), true);
});

test("aionis boundary --json prints raw boundary payload", async () => {
  const options = parseRuntimeInspectArgs("boundary", ["--json"], {
    AIONIS_URL: "http://runtime.local",
  });
  const payload = {
    surface_version: "runtime_boundary_inventory_response_v1",
    summary: {
      total_entries: 1,
      total_files: 1,
      authority_entries: 1,
      authority_producer_entries: 1,
    },
    files: ["src/kernel/learning-kernel.ts"],
  };
  const output = captureStdout();

  await runRuntimeInspectCommand(options, async () => jsonResponse(payload), output.stdout as unknown as typeof process.stdout);

  assert.deepEqual(JSON.parse(output.text()), payload);
});

test("aionis skills parses operator candidate list options", () => {
  const parsed = parseAionisArgs([
    "skills",
    "candidates",
    "--runtime-url",
    "http://runtime.local/",
    "--api-key",
    "sk-runtime",
    "--tenant-id",
    "tenant-a",
    "--scope",
    "tenant-a/repo",
    "--status",
    "all",
    "--limit",
    "7",
    "--json",
  ], {});

  assert.equal(parsed.command, "skills");
  assert.equal(parsed.options.action, "list");
  assert.equal(parsed.options.runtimeUrl, "http://runtime.local/");
  assert.equal(parsed.options.apiKey, "sk-runtime");
  assert.equal(parsed.options.tenantId, "tenant-a");
  assert.equal(parsed.options.scope, "tenant-a/repo");
  assert.equal(parsed.options.status, "all");
  assert.equal(parsed.options.limit, 7);
  assert.equal(parsed.options.json, true);

  assert.deepEqual(createSkillCandidateRuntimeRequest(parsed.options), {
    method: "GET",
    path: "/v1/skills/candidates?status=all&limit=7&tenant_id=tenant-a&scope=tenant-a%2Frepo",
  });
});

test("aionis skills builds promote and reject review requests", () => {
  const promote = parseSkillCandidateArgs([
    "promote",
    "skillcand_abc",
    "--reviewer-id",
    "operator-1",
    "--reason",
    "verified reusable trace",
  ], {});
  assert.deepEqual(createSkillCandidateRuntimeRequest(promote), {
    method: "POST",
    path: "/v1/skills/candidates/skillcand_abc/promote",
    body: {
      reviewer_id: "operator-1",
      reason: "verified reusable trace",
    },
  });

  const reject = parseSkillCandidateArgs(["reject", "skillcand_abc"], {});
  assert.deepEqual(createSkillCandidateRuntimeRequest(reject), {
    method: "POST",
    path: "/v1/skills/candidates/skillcand_abc/reject",
    body: {},
  });
});

test("aionis skills materialize previews without observe commit by default", async () => {
  const options = parseSkillCandidateArgs(["materialize", "skillcand_abc"], {
    AIONIS_URL: "http://runtime.local",
  });
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init });
    return jsonResponse({
      contract_version: "aionis_skill_candidate_materialize_result_v1",
      candidate_id: "skillcand_abc",
      draft: {
        title: "Trace-derived procedure: verify first",
        source_candidate_id: "skillcand_abc",
        procedure_steps: ["Read target file", "Run focused verifier"],
        acceptance_checks: ["verifier passed"],
      },
      recommended_observe_payload: {
        input_text: "draft",
      },
    });
  };
  const output = captureStdout();

  await runSkillCandidateCommand(options, fetchImpl, output.stdout as unknown as typeof process.stdout);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://runtime.local/v1/skills/candidates/skillcand_abc/materialize");
  assert.equal(output.text().includes("Not committed"), true);
});

test("aionis skills materialize --commit explicitly submits recommended observe payload", async () => {
  const options = parseSkillCandidateArgs(["materialize", "skillcand_abc", "--commit"], {
    AIONIS_URL: "http://runtime.local",
    AIONIS_API_KEY: "sk-runtime",
  });
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const responses = [
    {
      contract_version: "aionis_skill_candidate_materialize_result_v1",
      candidate_id: "skillcand_abc",
      draft: {
        title: "Trace-derived procedure: verify first",
        source_candidate_id: "skillcand_abc",
        procedure_steps: ["Read target file"],
      },
      recommended_observe_payload: {
        tenant_id: "default",
        scope: "default",
        input_text: "draft",
        execution: {
          summary: "draft",
        },
      },
    },
    {
      contract_version: "aionis_observe_result_v1",
      observed: {
        memory_written: true,
        execution_memory_count: 1,
      },
    },
  ];
  const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init });
    return jsonResponse(responses.shift());
  };
  const output = captureStdout();

  await runSkillCandidateCommand(options, fetchImpl, output.stdout as unknown as typeof process.stdout);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "http://runtime.local/v1/skills/candidates/skillcand_abc/materialize");
  assert.equal(calls[1].url, "http://runtime.local/v1/observe");
  assert.equal((calls[0].init?.headers as Record<string, string>)["x-api-key"], "sk-runtime");
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), responses[0] ?? {
    tenant_id: "default",
    scope: "default",
    input_text: "draft",
    execution: {
      summary: "draft",
    },
  });
  assert.equal(output.text().includes("Observe commit:"), true);
  assert.equal(output.text().includes("execution_memory_count=1"), true);
});
