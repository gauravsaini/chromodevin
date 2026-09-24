# Kevin — Project Timeline

## UPDATED ON : 2026-09-23

### feat (2026-09-23) — HF-compatible loader + inference sidecar + verify loop

1. **HF-compatible model loader**: `KevinModelConfig` + `parseModelRef` (`org/model:rev#dtype@device`), HF `pipeline_tag` auto-detect, device `auto` fallback (webgpu→wasm→cpu), dtype `auto` + OOM retry, `KEVIN_*` env support. Registry is advisory-only now.
2. **Weight fusion**: `browserDecision({modelOutput})` fuses classification/generation/embeddings over heuristic baseline; generic `describeModel` telemetry.
3. **Inference sidecar**: daemon `INFER` endpoint (`packages/daemon/infer.ts`), `InferenceTransport` + `transport?` in NanoClient, `kevin_infer` MCP tool, daemon-client `infer()` adapter.
4. **Verify-retry loop**: `runTask {requireVerify, maxAttempts}`, `planActVerifyStep`, `verified:false` on exhaustion.
5. **Honest docs**: Box 8 → Decision Fusion, Inference/Verify stages, port 9222, Stateful Stores note.
6. **Swarm execution**: 4 leaves via parallel `agyx` nodes under `/unlazy` gates (23/23 MET); new `agyx` PATH script replaced the `.zshrc` function.
7. **Tests** (before → after): full suite 143/147 → 169/170 (only pre-existing `playwright-e2e` env failure; `ws` import fix healed daemon-bridge 3/3).
8. **Files changed**: `packages/{core/ai,core/agent,daemon,mcp}`, `docs/*`, `README.md`, `scripts/verify-{docs,suite,typecheck}.mjs`, `tests/{daemon-infer,remote-infer,verify-loop}.test.ts`

## UPDATED ON : 2026-09-24

### feat (2026-09-24) — Hardened runtime, daemon security, URL policy, and MCP/driver validation

1. **False-success & step-limit fix**: Driver tracks locator execution explicitly to prevent false positives when actions fail; `agent-runtime` marks state failed and returns `{success: false}` on max step exhaustion.
2. **Daemon auth, queue & rate-limit**: Constant-time token verification (`KEVIN_DAEMON_TOKEN`), per-tab command serialization queue, rate limiting (60 req/min), and payload size guardrails.
3. **URL policy creation & integration**: Built `url-policy.ts` SSRF/private-network guard; integrated into action schema validation to prevent unauthorized or dangerous browser navigations.
4. **Direct act validation**: `createKevin.act()` validates payloads via `action-schema` and executes high-risk action confirmation hooks (`classifyActionRisk`) prior to engine execution.
5. **MCP & WebMCP tightening**: Enforced strict JSON-RPC 2.0 conformance (id types, rpc versions, batch rejection); updated `WebMcpClient` tool matching with camelCase tokenization and min-match thresholds.
6. **WebGPU honesty & README softening**: Documented realistic WebGPU hardware requirements and WASM/CPU fallback behavior; aligned README claims with local execution capabilities.
7. **Follow-up / pnpm standardization**: Workspace currently relies on `yarn.lock` with yarn commands in README; migration to pnpm scheduled via import without lockfile churn.
8. **Tests** (before → after): full suite 170/170 → 197+/197+ (reported passing across core, daemon, mcp, and playwright test suites).
9. **Files changed**: `packages/core/{actions,agent,mcp,security}`, `packages/daemon/*`, `packages/mcp/server.ts`, `packages/playwright/*`, `tests/*`

## UPDATED ON : 2026-09-24

### chore (2026-09-24) — Wave 6 leftovers: README honesty, src guard, pnpm baseline

1. **README honesty**: softened absolute claims to measured scope, env-dependent benchmark note.
2. **src guard**: `packages/core` canonical, `src/` re-export facade enforced by `scripts/verify-docs.mjs` + `tests/src-guard.test.ts`.
3. **pnpm baseline**: `packageManager: pnpm@10.28.2`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` via `pnpm import`; `yarn.lock` kept.
4. **Tests** (before → after): 202/202 → 203/203, `tsc` clean, `build` pass.
5. **Files changed**: `README.md`, `scripts/verify-docs.mjs`, `src/index.ts`, `package.json`, `pnpm-workspace.yaml`, `tests/src-guard.test.ts`
