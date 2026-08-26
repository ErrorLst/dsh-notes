import { tmpdir } from "node:os";
import { join } from "node:path";
//#region src/resident-preset.mjs
const RESIDENT_PRESET_YML = "name: 常驻会话专用\ndescription: 基于标准预置的常驻会话专用版：固定禁用 ask_user_question 等网页弹窗交互工具（常驻会话卡片没有弹窗渲染通道）；其余能力与标准一致。\norder: 5";
const RESIDENT_AGENT_CORDIS_YML = "# The `resident` agent preset: the dsh-notes 常驻会话 (resident card) agent.\n#\n# Base: the built-in `standard` preset, unchanged except:\n#   1. persona 增加常驻卡片语境说明（无弹窗通道，需要用户决定时以纯文本提问并结束回合）;\n#   2. tool-ask-user 固定禁用 —— 常驻会话卡片没有 ask/审批/计划确认等网页弹窗的渲染通道，\n#      调用会静默挂起或失败。\n#\n# This file is an AGENT-PLANE composition, mounted once per session naming\n# the preset. Host-plane facts (registries, sandbox and approval stack,\n# persistence, model routes) stay in the host composition.\n\n# A service row here MUST sit inside a group carrying an `isolate` realm.\n# Without one it publishes into the root realm, where it is process-global —\n# another preset publishing the same name collides, and a host reader would\n# resolve one preset's instance for every session; `dsh-agent-presets` rejects\n# that at mount. `true` means an entry-local realm: this standing mount's own\n# private instance, apart from every other preset's. (A shared label does NOT\n# pool instances — `provide()` throws on the second registration under the\n# same realm symbol; labels join REALMS, and are not what this file needs.)\n\n# ── identity ────────────────────────────────────────────────────────────────\n\n# The preset's own persona, shadowing the deployment default for this agent.\n# `{{model}}` and `{{cwd}}` resolve from the agent's own route and workspace.\n- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: >-\n      You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.\n\n      You run inside the dsh-notes 常驻会话 card on the chat page. The GUI has no popup channel for you: you have no ask_user_question tool and no approval dialog. When a decision belongs to the user, state the question as plain text in your reply and end the turn with no tool calls — the user's next message answers it.\n\n- id: agent-instructions\n  name: '@deepseek-ai/dsh-agent-instructions'\n  config:\n    maxBytes: 65536\n\n# ── shell ───────────────────────────────────────────────────────────────────\n\n# `shell-env` stays in the HOST composition: `apps/cli/src/web.ts` injects it to\n# publish `DSH_WEB_URL`/`DSH_WEB_MODE`, and a host row that injects a service is\n# the criterion for host-plane ownership — injection resolves before any session\n# exists, so there is no agent to key by. Behind a preset realm those variables\n# never reached the model's shell at all. Both shell tools consume the host\n# registry from here; their executors (`bash-sandbox`/`pwsh-sandbox`) are\n# host-plane too.\n- id: tool-bash\n  name: '@deepseek-ai/dsh-tool-bash'\n  disabled: !!js process.platform === 'win32'\n\n- id: tool-pwsh\n  name: '@deepseek-ai/dsh-tool-pwsh'\n  disabled: !!js process.platform !== 'win32'\n\n# ── filesystem ──────────────────────────────────────────────────────────────\n\n# Both register into the host `tools` registry and provide nothing, so\n# they need no realm. The `fs` service and its policy stay in the host.\n- id: tool-fs\n  name: '@deepseek-ai/dsh-tool-fs'\n\n- id: tool-fs-search\n  name: '@deepseek-ai/dsh-tool-fs-search'\n  config:\n    sampleOverCapGlobResults: false\n\n# ── background jobs ────────────────────────────────────────────────────────\n\n# Only the model-facing controls. The task REGISTRY stays on the host plane:\n# its producers sit outside any realm this file could put it in — `tool-bash`\n# above resolves it with `ctx.get`, and an entry-local realm here is invisible\n# to every sibling row, so `run_in_background` would answer \"background jobs\n# unavailable\" while these controls sat in the catalog. The registry is keyed by\n# owning agent anyway, so one host instance serves every session. What a preset\n# chooses is whether its agent can collect and stop background work at all.\n- id: tool-jobs\n  name: '@deepseek-ai/dsh-tool-jobs'\n\n# ── skills ──────────────────────────────────────────────────────────────────\n\n# The skill REGISTRY lives in the host composition and is layered per scope:\n# these rows register into THIS preset's layer of it, so they need no realm.\n# `skill-filesystem` contributes local-root discovery for agents on this preset, and\n# `tool-skill` gives them the catalog and loader; the merged catalog also\n# carries whatever the deployment registered globally (repository plugins).\n- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'\n\n- id: tool-skill\n  name: '@deepseek-ai/dsh-tool-skill'\n\n# ── goals ───────────────────────────────────────────────────────────────────\n\n# Only the model-facing tool. The goal SERVICE, its session driver, and the\n# `/goal` command stay on the host plane: the Gateway serves the goal domain as\n# Remote endpoints whose receiver comes from a generated descriptor, so it\n# resolves `goals` on the host and an entry-local realm here would hide it. The\n# registry is keyed by session anyway, so one host instance serves every\n# session. What a preset chooses is whether its agent can call the goal tool.\n- id: tool-goal\n  name: '@deepseek-ai/dsh-tool-goal'\n\n# ── plan mode ───────────────────────────────────────────────────────────────\n\n# Plan state is per-agent by nature, so an entry-local realm is not a\n# workaround here — it is the correct lifetime.\n- id: planning\n  name: cordis:group\n  group: true\n  isolate:\n    planMode: true\n  config:\n    - id: plan-mode\n      name: '@deepseek-ai/dsh-plan-mode'\n      config:\n        section: |\n              You are in plan mode. Stay in plan mode until exit_plan_mode succeeds or the user switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user's conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.\n\n              Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual repository. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.\n\n              The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed to keep the tool catalog unchanged. Do not use todo_write to track this planning phase: it tracks implementation after an approved plan, while the plan itself belongs in exit_plan_mode.\n\n              Resolve discoverable facts by inspection. Use ask_user_question only for user-owned choices or material ambiguity that inspection cannot answer. Do not ask the user where code lives or how current behavior works when you can find out.\n\n              Make the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions.\n\n              When ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask \"should I proceed?\" through prose or ask_user_question. If review rejects it, incorporate the feedback and present again. If the review channel is unavailable or aborted, stay in plan mode and ask the user to switch modes manually; do not proceed with implementation.\n\n# ── compaction ──────────────────────────────────────────────────────────────\n\n# `compaction-basic` reads `toolResultPrune` through `ctx.get`, so the pruner must\n# share this realm rather than sit outside it.\n#\n# `tokenMeter` is deliberately NOT in this realm: the meter stays on the HOST\n# plane, and the rows here resolve that one instance. It takes no configuration,\n# keys every fold by Session, and owns the context-meter projection units the\n# browser reads for every session — behind a realm those units would come and go\n# with whichever presets happen to be mounted. What a preset chooses is whether\n# its agent compacts at all, which is `compaction-basic` below.\n- id: compaction\n  name: cordis:group\n  group: true\n  isolate:\n    compaction: true\n    toolResultPruner: true\n  config:\n    - id: compaction-basic\n      name: '@deepseek-ai/dsh-compaction-basic'\n\n    - id: command-compact\n      name: '@deepseek-ai/dsh-command-compact'\n\n    - id: tool-result-pruner\n      name: '@deepseek-ai/dsh-compaction-tool-result-pruner'\n      config:\n        thresholdChars: 8192\n        headChars: 4096\n        tailChars: 1024\n\n# ── delegation and workflows ────────────────────────────────────────────────\n\n# The `subagents` registry and its spawn/fork backends live in the HOST\n# composition: the registry is a process singleton whose cross-session queries\n# the api-proxy serves to the browser, and a provider name may only be\n# registered once. This preset contributes the delegation TOOLS, which resolve\n# that host registry.\n#\n# `workflows` is different — nothing outside an agent reads it — so every row\n# that reaches it shares one entry-local realm here, and a consumer left\n# outside would resolve a host registry this preset does not populate.\n#\n# `tool-subagent-report` is host-plane for the same reason as the registry,\n# not because a preset may not want it: it registers a CONTINUABLE SETUP on\n# that singleton rather than a tool this agent calls, and the setup list is\n# not scope-aware — one copy per mounted preset means every child gets\n# `report` registered once per live session, which throws on the second.\n- id: delegation\n  name: cordis:group\n  group: true\n  isolate:\n    workflowEngine: true\n  config:\n    - id: tool-subagent-control\n      name: '@deepseek-ai/dsh-tool-subagent-control'\n\n    - id: tool-subagent-list-agents\n      name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'\n\n    - id: tool-subagent\n      name: '@deepseek-ai/dsh-tool-subagent'\n      config:\n        provider: spawn\n        toolName: subagent\n        backgroundMode: continuable\n\n    - id: tool-subagent-fork\n      name: '@deepseek-ai/dsh-tool-subagent'\n      config:\n        provider: fork\n        toolName: subagent_fork\n        backgroundMode: continuable\n\n    # Production dsh does not install these optional providers. Install the\n    # matching Bundle in this Profile and restart the Host, then copy this\n    # preset and remove `disabled` from the matching tool row. Host availability\n    # alone grants no tool.\n    - id: tool-subagent-codex\n      name: '@deepseek-ai/dsh-tool-subagent'\n      disabled: true\n      config:\n        provider: codex\n        toolName: subagent_codex\n        backgroundMode: one-shot\n        maxDepth: provider-managed\n\n    - id: tool-subagent-claude-code\n      name: '@deepseek-ai/dsh-tool-subagent'\n      disabled: true\n      config:\n        provider: claude-code\n        toolName: subagent_claude_code\n        backgroundMode: one-shot\n        maxDepth: provider-managed\n\n    - id: workflow-worker-thread\n      name: '@deepseek-ai/dsh-workflow-worker-thread'\n      config:\n        provider: spawn\n\n    - id: tool-workflow\n      name: '@deepseek-ai/dsh-tool-workflow'\n\n    - id: tool-ralph\n      name: '@deepseek-ai/dsh-tool-ralph'\n      config:\n        subagentProvider: spawn\n        maxRounds: 64\n\n# ── remaining model-facing rows ─────────────────────────────────────────────\n\n# ask_user_question 需要网页弹窗交互，常驻会话卡片没有弹窗渲染通道，\n# 调用会挂起/失败 —— 固定禁用（保留行以便溯源，去掉 disabled 即恢复）。\n- id: tool-ask-user\n  name: '@deepseek-ai/dsh-tool-ask-user'\n  disabled: true\n\n- id: tool-todo\n  name: '@deepseek-ai/dsh-tool-todo'\n  config:\n    allowParallelInProgress: true\n\n# The `web` service and its search provider stay in the host composition; only\n# the model-facing tool is per-session.\n- id: tool-web\n  name: '@deepseek-ai/dsh-tool-web'\n  config:\n    fetch: false\n    searchTimeoutMs: 60000";
//#endregion
//#region src/index.mjs
const name = "dsh-notes";
const inject = ["webServer"];
const TODO_TEXT_MAX = 500;
const DETAIL_MAX = 2e4;
const MEMO_MAX = 2e4;
const ROUTE_PATH = "/api/dsh-notes";
const UNDO_CAP = 100;
const RESIDENT_TMP_SUBDIR = "dsh-notes-resident";
const RESIDENT_PRESET_ID = "resident";
const passthroughSchema = {
	parse(value) {
		if (value === null) throw new Error("null not allowed");
		return value;
	},
	safeParse(value) {
		return value === null ? { success: false } : {
			success: true,
			data: value
		};
	}
};
const notesDomainSpec = {
	name: "notes",
	version: 1,
	global: {
		schema: passthroughSchema,
		initial: {
			todos: [],
			memo: ""
		}
	},
	tables: { workspaces: { valueSchema: passthroughSchema } }
};
function copyScope(scope) {
	return {
		todos: scope.todos.map((item) => ({
			id: item.id,
			text: item.text,
			done: item.done,
			pinned: item.pinned === true,
			detail: typeof item.detail === "string" ? item.detail : "",
			createdAt: item.createdAt,
			updatedAt: item.updatedAt
		})),
		memo: scope.memo
	};
}
function emptyScope() {
	return {
		todos: [],
		memo: ""
	};
}
function openCount(todos) {
	let count = 0;
	for (const item of todos) if (!item.done) count += 1;
	return count;
}
function snapshotOf(domain, workspaceId) {
	const globalScope = domain.global.get();
	const table = domain.table("workspaces");
	const workspaceScope = workspaceId !== null ? table.get(workspaceId) : void 0;
	return {
		global: copyScope(globalScope),
		workspace: workspaceScope === void 0 ? null : copyScope(workspaceScope),
		counts: {
			globalOpen: openCount(globalScope.todos),
			workspaceOpen: workspaceScope === void 0 ? 0 : openCount(workspaceScope.todos)
		}
	};
}
function apply(ctx, config = {}) {
	const webServer = ctx.webServer;
	const storageDomain = ctx.get("storageDomain");
	if (storageDomain === void 0) {
		ctx.logger.error("[dsh-notes] storageDomain unavailable; notes API disabled");
		return;
	}
	let chain = Promise.resolve();
	function enqueue(job) {
		const result = chain.then(job);
		chain = result.then(() => {}, () => {});
		return result;
	}
	const undoMap = /* @__PURE__ */ new Map();
	function undoKeyOf(scope, workspaceId) {
		return scope === "global" ? "global" : `workspace:${workspaceId}`;
	}
	function recordUndo(key, removed) {
		undoMap.delete(key);
		undoMap.set(key, removed);
		while (undoMap.size > UNDO_CAP) {
			const oldest = undoMap.keys().next().value;
			undoMap.delete(oldest);
		}
	}
	function clearUndo(key) {
		undoMap.delete(key);
	}
	const domainPromise = storageDomain.open(notesDomainSpec).catch((error) => {
		ctx.logger.error(`[dsh-notes] failed to open notes domain: ${String(error)}`);
		return null;
	});
	ctx.effect(() => () => {
		domainPromise.then((domain) => {
			if (domain !== null) return domain.close();
		});
	});
	async function requireDomain() {
		const domain = await domainPromise;
		if (domain === null) throw new Error("storage-unavailable");
		return domain;
	}
	function parseScope(body) {
		const scope = body.scope;
		if (scope === "global") return {
			scope,
			workspaceId: null
		};
		if (scope === "workspace") {
			const workspaceId = typeof body.workspaceId === "string" && body.workspaceId !== "" ? body.workspaceId : null;
			if (workspaceId === null) return { error: "bad-args" };
			return {
				scope,
				workspaceId
			};
		}
		return { error: "bad-args" };
	}
	function mutate(scope, workspaceId, fn) {
		return enqueue(async () => {
			const domain = await requireDomain();
			if (scope === "global") {
				const next = fn(copyScope(domain.global.get()));
				await domain.global.set(next);
				return snapshotOf(domain, workspaceId);
			}
			const table = domain.table("workspaces");
			const current = table.get(workspaceId);
			const next = fn(current === void 0 ? emptyScope() : copyScope(current));
			await table.put(workspaceId, next);
			return snapshotOf(domain, workspaceId);
		});
	}
	function pushTodo(todos, text, detail) {
		const trimmed = String(text).trim().slice(0, TODO_TEXT_MAX);
		if (trimmed === "") return todos;
		const trimmedDetail = typeof detail === "string" ? detail.slice(0, DETAIL_MAX) : "";
		const now = Date.now();
		const item = {
			id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
			text: trimmed,
			done: false,
			pinned: false,
			...trimmedDetail === "" ? {} : { detail: trimmedDetail },
			createdAt: now,
			updatedAt: now
		};
		return [...todos, item];
	}
	function applyAction(action, body) {
		const parsed = parseScope(body);
		if (parsed.error !== void 0) return Promise.resolve({ error: parsed.error });
		const { scope, workspaceId } = parsed;
		const undoKey = undoKeyOf(scope, workspaceId);
		switch (action) {
			case "add":
				if (typeof body.text !== "string") return Promise.resolve({ error: "bad-args" });
				clearUndo(undoKey);
				return mutate(scope, workspaceId, (current) => ({
					...current,
					todos: pushTodo(current.todos, body.text, typeof body.detail === "string" ? body.detail : "")
				}));
			case "toggle":
				if (typeof body.id !== "string" || typeof body.done !== "boolean") return Promise.resolve({ error: "bad-args" });
				clearUndo(undoKey);
				return mutate(scope, workspaceId, (current) => ({
					...current,
					todos: current.todos.map((item) => item.id === body.id ? {
						...item,
						done: body.done,
						updatedAt: Date.now()
					} : item)
				}));
			case "edit": {
				if (typeof body.id !== "string" || typeof body.text !== "string") return Promise.resolve({ error: "bad-args" });
				const text = body.text.trim().slice(0, TODO_TEXT_MAX);
				if (text === "") return Promise.resolve({ error: "bad-args" });
				clearUndo(undoKey);
				const hasDetail = typeof body.detail === "string";
				const detail = hasDetail ? body.detail.slice(0, DETAIL_MAX) : void 0;
				return mutate(scope, workspaceId, (current) => ({
					...current,
					todos: current.todos.map((item) => {
						if (item.id !== body.id) return item;
						const next = {
							...item,
							text,
							updatedAt: Date.now()
						};
						if (hasDetail) if (detail === "") delete next.detail;
						else next.detail = detail;
						return next;
					})
				}));
			}
			case "delete":
				if (typeof body.id !== "string") return Promise.resolve({ error: "bad-args" });
				return mutate(scope, workspaceId, (current) => {
					const removed = [];
					const indices = [];
					const todos = current.todos.filter((item, index) => {
						if (item.id === body.id) {
							removed.push(item);
							indices.push(index);
							return false;
						}
						return true;
					});
					if (removed.length > 0) recordUndo(undoKey, {
						removed,
						indices
					});
					return {
						...current,
						todos
					};
				});
			case "clear-done": return mutate(scope, workspaceId, (current) => {
				const removed = [];
				const indices = [];
				const todos = current.todos.filter((item, index) => {
					if (item.done) {
						removed.push(item);
						indices.push(index);
						return false;
					}
					return true;
				});
				if (removed.length > 0) recordUndo(undoKey, {
					removed,
					indices
				});
				return {
					...current,
					todos
				};
			});
			case "pin":
				if (typeof body.id !== "string" || typeof body.pinned !== "boolean") return Promise.resolve({ error: "bad-args" });
				clearUndo(undoKey);
				return mutate(scope, workspaceId, (current) => {
					let found = false;
					const todos = current.todos.map((item) => {
						if (item.id !== body.id) return item;
						found = true;
						return {
							...item,
							pinned: body.pinned,
							updatedAt: Date.now()
						};
					});
					if (!found) return current;
					const item = todos.find((it) => it.id === body.id);
					return {
						...current,
						todos: body.pinned ? [item, ...todos.filter((it) => it.id !== body.id)] : todos
					};
				});
			case "reorder":
				if (!Array.isArray(body.orderedIds) || body.orderedIds.some((id) => typeof id !== "string")) return Promise.resolve({ error: "bad-args" });
				clearUndo(undoKey);
				return mutate(scope, workspaceId, (current) => {
					const byId = new Map(current.todos.map((item) => [item.id, item]));
					const ordered = [];
					for (const id of body.orderedIds) {
						const item = byId.get(id);
						if (item !== void 0) {
							ordered.push(item);
							byId.delete(id);
						}
					}
					for (const item of byId.values()) ordered.push(item);
					return {
						...current,
						todos: ordered
					};
				});
			case "set-memo":
				if (typeof body.text !== "string") return Promise.resolve({ error: "bad-args" });
				clearUndo(undoKey);
				return mutate(scope, workspaceId, (current) => ({
					...current,
					memo: body.text.slice(0, MEMO_MAX)
				}));
			case "undo-delete": {
				const record = undoMap.get(undoKey);
				if (record === void 0) return Promise.resolve({ error: "no-undo" });
				undoMap.delete(undoKey);
				return mutate(scope, workspaceId, (current) => {
					const todos = [...current.todos];
					for (let i = 0; i < record.removed.length; i += 1) {
						const at = Math.min(record.indices[i], todos.length);
						todos.splice(at, 0, record.removed[i]);
					}
					return {
						...current,
						todos
					};
				});
			}
			default: return Promise.resolve({ error: "bad-args" });
		}
	}
	const scard = setupScard(ctx);
	function sendJson(res, status, payload) {
		res.writeHead(status, {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store"
		});
		res.end(JSON.stringify(payload));
	}
	ctx.effect(() => webServer.register({
		kind: "exact",
		path: ROUTE_PATH,
		handler: async (req, res) => {
			if (req.method === "GET" || req.method === "HEAD") {
				const workspaceId = new URL(req.url ?? "/", "http://local").searchParams.get("workspaceId");
				try {
					sendJson(res, 200, {
						ok: true,
						...snapshotOf(await requireDomain(), workspaceId !== null && workspaceId !== "" ? workspaceId : null)
					});
				} catch (error) {
					sendJson(res, 503, {
						ok: false,
						error: "storage-unavailable"
					});
				}
				return;
			}
			if (req.method !== "POST") {
				sendJson(res, 405, {
					ok: false,
					error: "METHOD"
				});
				return;
			}
			let body;
			try {
				body = await readJson(req);
			} catch {
				sendJson(res, 400, {
					ok: false,
					error: "bad-json"
				});
				return;
			}
			const action = typeof body.action === "string" ? body.action : "";
			if (action.startsWith("scard-")) {
				if (!scard.enabled) {
					sendJson(res, 503, {
						ok: false,
						error: "scard-unavailable"
					});
					return;
				}
				try {
					const result = await scard.handle(action, body);
					if (result.ok === true) {
						sendJson(res, 200, result);
						return;
					}
					sendJson(res, result.error === "scard-unavailable" ? 503 : 400, result);
				} catch (error) {
					ctx.logger.warn(`[dsh-notes] scard '${action}' failed: ${String(error)}`);
					sendJson(res, 503, {
						ok: false,
						error: "scard-failed"
					});
				}
				return;
			}
			try {
				const result = await applyAction(action, body);
				if (result.error !== void 0) {
					sendJson(res, result.error === "no-undo" ? 404 : 400, {
						ok: false,
						error: result.error
					});
					return;
				}
				sendJson(res, 200, {
					ok: true,
					state: result
				});
			} catch (error) {
				ctx.logger.warn(`[dsh-notes] action '${action}' failed: ${String(error)}`);
				sendJson(res, 503, {
					ok: false,
					error: "storage-unavailable"
				});
			}
		}
	}), "dsh-notes: route");
}
function setupScard(ctx) {
	const agents = ctx.get("agents");
	const agentPresets = ctx.get("agentPresets");
	const llm = ctx.get("llm");
	const agentDefaultModel = ctx.get("agentDefaultModel");
	const workspaceRegistry = ctx.get("workspaceRegistry");
	const sessionTitle = ctx.get("sessionTitle");
	const sessionPersistence = ctx.get("sessionPersistence");
	const sandboxPolicy = ctx.get("sandboxPolicy");
	const fs = ctx.get("fs");
	if (agents === void 0 || agentPresets === void 0 || llm === void 0) {
		ctx.logger.warn("[dsh-notes] scard disabled: agents/agentPresets/llm unavailable");
		return {
			enabled: false,
			handle: () => ({
				ok: false,
				error: "scard-unavailable"
			})
		};
	}
	let stateFilePromise = null;
	function resolveStateFile() {
		if (stateFilePromise !== null) return stateFilePromise;
		const root = sandboxPolicy === void 0 ? void 0 : sandboxPolicy.workspaceRoot;
		if (fs === void 0 || typeof fs.resolve !== "function" || typeof root !== "string" || root === "") {
			stateFilePromise = Promise.resolve(null);
			return stateFilePromise;
		}
		stateFilePromise = fs.resolve(join(root, ".dsh", "session-card.json")).catch((error) => {
			ctx.logger.warn(`[dsh-notes] failed to resolve session-card state path: ${String(error)}`);
			return null;
		});
		return stateFilePromise;
	}
	async function readStateFile() {
		if (fs === void 0) return void 0;
		const stateFile = await resolveStateFile();
		if (stateFile === null) return void 0;
		try {
			const text = await fs.readText(stateFile);
			const parsed = JSON.parse(text);
			if (typeof parsed.sessionId !== "string" || parsed.sessionId === "") return void 0;
			return {
				sessionId: parsed.sessionId,
				presetId: typeof parsed.presetId === "string" && parsed.presetId !== "" ? parsed.presetId : void 0,
				provider: typeof parsed.provider === "string" && parsed.provider !== "" ? parsed.provider : void 0,
				model: typeof parsed.model === "string" && parsed.model !== "" ? parsed.model : void 0,
				effort: typeof parsed.effort === "string" && parsed.effort !== "" ? parsed.effort : void 0
			};
		} catch {
			return;
		}
	}
	/** 持久化常驻会话设置（预设/模型/思考等级）；cwd 不持久化。 */
	async function writeStateFile(sessionId, settings) {
		if (fs === void 0) return;
		const stateFile = await resolveStateFile();
		if (stateFile === null) return;
		try {
			const record = { sessionId };
			if (settings?.presetId !== void 0) record.presetId = settings.presetId;
			if (settings?.provider !== void 0) record.provider = settings.provider;
			if (settings?.model !== void 0) record.model = settings.model;
			if (settings?.effort !== void 0) record.effort = settings.effort;
			await fs.writeText(stateFile, JSON.stringify(record));
		} catch (error) {
			ctx.logger.warn(`[dsh-notes] failed to write session-card state: ${String(error)}`);
		}
	}
	let presetFilesEnsured = false;
	async function ensureResidentPresetFiles() {
		if (presetFilesEnsured) return;
		presetFilesEnsured = true;
		const root = sandboxPolicy === void 0 ? void 0 : sandboxPolicy.workspaceRoot;
		if (fs === void 0 || typeof fs.resolve !== "function" || typeof root !== "string" || root === "") return;
		const dir = join(root, ".dsh", ".agent-presets", "resident");
		await maybeWrite("preset.yml", RESIDENT_PRESET_YML);
		await maybeWrite("agent.cordis.yml", RESIDENT_AGENT_CORDIS_YML);
		async function maybeWrite(name, content) {
			try {
				const target = await fs.resolve(join(dir, name));
				try {
					if (await fs.readText(target) === content) return;
				} catch {}
				await fs.writeText(target, content);
				ctx.logger.info(`[dsh-notes] provisioned resident preset: ${name}`);
			} catch (error) {
				ctx.logger.warn(`[dsh-notes] failed to provision resident preset ${name}: ${String(error)}`);
			}
		}
	}
	const residentTempDir = (() => {
		try {
			return join(tmpdir(), RESIDENT_TMP_SUBDIR);
		} catch {
			return null;
		}
	})();
	function residentCwd() {
		if (residentTempDir !== null) return residentTempDir;
		try {
			if (sandboxPolicy !== void 0 && sandboxPolicy.workspaceRoot !== void 0) return String(sandboxPolicy.workspaceRoot);
		} catch {}
	}
	const overrides = /* @__PURE__ */ new Map();
	const revisions = /* @__PURE__ */ new Map();
	let residentPromise = null;
	/** 常驻会话持久化设置（读状态文件获得；scard-select-preset/model 更新并落盘） */
	let residentSettings = {};
	ctx.on("agent/request", async (payload, next) => {
		const resolved = await next();
		const id = payload?.agent?.id;
		if (id === void 0) return resolved;
		const override = overrides.get(id);
		if (override === void 0) return resolved;
		const { reasoningEffort: _inherited, ...rest } = resolved;
		return {
			...rest,
			provider: override.provider,
			model: override.model,
			...override.effort === void 0 ? {} : { reasoningEffort: override.effort }
		};
	});
	ctx.on("session/event", (session, event) => {
		const id = session?.id;
		if (id === void 0 || id !== residentIdRef.current) return;
		revisions.set(id, (revisions.get(id) ?? 0) + 1);
	});
	ctx.on("agent/disposed", (subject) => {
		const id = subject?.id ?? subject?.agent?.id;
		if (id !== void 0) overrides.delete(id);
	});
	const residentIdRef = { current: null };
	/** 常驻会话 setup：cwd 变量兜底 + 挂载预设（新建/恢复共用）。 */
	async function mountResidentSetup(agentCtx, presetId) {
		const cwd = residentCwd();
		if (cwd !== null && cwd !== void 0) try {
			const systemPrompt = agentCtx.get("systemPrompt");
			if (systemPrompt !== void 0 && typeof systemPrompt.variable === "function") systemPrompt.variable("cwd", (context) => {
				try {
					const headerCwd = context?.agent?.session?.header?.cwd;
					if (typeof headerCwd === "string" && headerCwd !== "") return headerCwd;
				} catch {}
				return cwd;
			});
		} catch (error) {
			ctx.logger.warn(`[dsh-notes] resident cwd variable failed: ${String(error)}`);
		}
		try {
			await agentPresets.mount(agentCtx, presetId);
		} catch (error) {
			ctx.logger.warn(`[dsh-notes] resident preset mount failed: ${String(error)}`);
		}
	}
	function defaultSelection() {
		try {
			const selection = agentDefaultModel?.currentSelection?.();
			if (selection && typeof selection.provider === "string" && typeof selection.model === "string") return {
				provider: selection.provider,
				model: selection.model
			};
		} catch {}
	}
	/** 持久化设置折叠为 agentOptions（预设/模型/思考等级；无则 undefined）。 */
	function persistedSelection() {
		if (typeof residentSettings.provider === "string" && residentSettings.provider !== "" && typeof residentSettings.model === "string" && residentSettings.model !== "") return {
			provider: residentSettings.provider,
			model: residentSettings.model,
			...residentSettings.effort === void 0 ? {} : { reasoningEffort: residentSettings.effort }
		};
	}
	/** 冷恢复后把持久化模型/思考等级同步进 agent/request 覆盖层。
	* agentOptions 的 reasoningEffort 不会被 agent-loop 直接播种到请求，
	* 必须经全局瀑布监听显式应用（与 scard-select-model 同一路径）。 */
	function applyPersistedOverride(id) {
		const persisted = persistedSelection();
		if (persisted === void 0) return;
		overrides.set(id, {
			provider: persisted.provider,
			model: persisted.model,
			...persisted.reasoningEffort === void 0 ? {} : { effort: persisted.reasoningEffort }
		});
	}
	async function createResident() {
		const sessionId = "sesscard-" + Math.random().toString(36).slice(2, 10);
		const cwd = residentCwd();
		const selection = persistedSelection() ?? defaultSelection();
		const presetId = RESIDENT_PRESET_ID;
		let handle;
		let fallback = false;
		try {
			handle = await agents.create({
				sessionId,
				...selection === void 0 ? {} : { agentOptions: selection },
				meta: { cwd },
				setup: async (agentCtx) => {
					await mountResidentSetup(agentCtx, presetId);
				}
			});
		} catch (error) {
			fallback = true;
			ctx.logger.warn(`[dsh-notes] resident create with persisted selection failed (${String(error?.message ?? error)}), retrying with default`);
			handle = await agents.create({
				sessionId,
				...defaultSelection() === void 0 ? {} : { agentOptions: defaultSelection() },
				meta: { cwd },
				setup: async (agentCtx) => {
					await mountResidentSetup(agentCtx, void 0);
				}
			});
		}
		if (!fallback) applyPersistedOverride(sessionId);
		const agent = handle.agent;
		try {
			if (sessionTitle !== void 0) await sessionTitle.rename(agent.session, "常驻会话");
		} catch (error) {
			ctx.logger.warn(`[dsh-notes] rename resident failed: ${String(error)}`);
		}
		await writeStateFile(sessionId, residentSettings);
		return sessionId;
	}
	async function resumeAgent(id) {
		const existing = agents.get(id);
		if (existing !== void 0) {
			applyPersistedOverride(id);
			return existing;
		}
		const selection = persistedSelection() ?? defaultSelection();
		const presetId = RESIDENT_PRESET_ID;
		const handle = await agents.resume({
			resumeSessionId: id,
			...selection === void 0 ? {} : { agentOptions: selection },
			setup: async (agentCtx) => {
				await mountResidentSetup(agentCtx, presetId);
			}
		});
		applyPersistedOverride(id);
		return handle.agent;
	}
	/** 单飞：确保常驻会话存在（创建或复用），返回 sessionId；失败返回 null。 */
	function ensureResident() {
		residentPromise ??= (async () => {
			const state = await readStateFile();
			residentSettings = {
				presetId: RESIDENT_PRESET_ID,
				...state?.provider === void 0 ? {} : { provider: state.provider },
				...state?.model === void 0 ? {} : { model: state.model },
				...state?.effort === void 0 ? {} : { effort: state.effort }
			};
			if (state?.sessionId !== void 0 && state?.presetId !== RESIDENT_PRESET_ID) await writeStateFile(state.sessionId, residentSettings);
			await ensureResidentPresetFiles();
			let id = state?.sessionId;
			if (id !== void 0 && sessionPersistence !== void 0) try {
				const rows = await sessionPersistence.list();
				if (!(Array.isArray(rows) && rows.some((row) => (row?.id ?? row?.sessionId) === id))) id = void 0;
			} catch {
				id = void 0;
			}
			if (id === void 0) id = await createResident();
			else try {
				const agent = await resumeAgent(id);
				if (agent !== void 0 && !agent.session.events.some((ev) => ev.type === "turn/start") && residentCwd() !== null && residentCwd() !== void 0 && agent.session.header?.cwd !== residentCwd()) {
					try {
						if (workspaceRegistry !== void 0) await workspaceRegistry.archiveSession(id);
					} catch (error) {
						ctx.logger.warn(`[dsh-notes] archiveSession failed: ${String(error)}`);
					}
					overrides.delete(id);
					revisions.delete(id);
					id = await createResident();
				}
			} catch (error) {
				ctx.logger.warn(`[dsh-notes] resident resume failed: ${String(error)}`);
			}
			residentIdRef.current = id;
			return id;
		})().catch((error) => {
			residentPromise = null;
			ctx.logger.warn(`[dsh-notes] scard ensure failed: ${String(error)}`);
			return null;
		});
		return residentPromise;
	}
	function foldedPresetOf(session) {
		try {
			const header = typeof session.requestHeader === "function" ? session.requestHeader() : void 0;
			if (header && typeof header.agentPreset === "string") return header.agentPreset;
		} catch {}
		const events = session.events ?? [];
		for (let i = events.length - 1; i >= 0; i--) {
			const ev = events[i];
			if (ev.type === "agent-preset/selected" && ev.data && typeof ev.data.agentPreset === "string") return ev.data.agentPreset;
		}
	}
	function isRunning(session) {
		let running = false;
		for (const ev of session.events ?? []) if (ev.type === "turn/start") running = true;
		else if (ev.type === "turn/end") running = false;
		return running;
	}
	function textOfBlocks(content) {
		if (!Array.isArray(content)) return "";
		let out = "";
		for (const block of content) if (block && block.type === "text" && typeof block.text === "string") out += block.text;
		return out;
	}
	const CONTEXT_FORM_LABELS = {
		instructions: "工作区指令",
		catalog: "目录",
		snapshot: "快照",
		notice: "通知",
		relay: "转达",
		recall: "跨会话召回"
	};
	function recordOf(source) {
		return source !== null && typeof source === "object" ? source : null;
	}
	function stringOf(value) {
		return typeof value === "string" && value !== "" ? value : null;
	}
	function collectStrings(record, key, subKey) {
		const list = Array.isArray(record[key]) ? record[key] : null;
		if (list === null) return null;
		const out = [];
		for (const item of list) if (item !== null && typeof item === "object" && stringOf(item[subKey]) !== null) out.push(item[subKey]);
		else if (subKey === void 0 && stringOf(item) !== null) out.push(item);
		return out.length > 0 ? out : null;
	}
	function contextProvenanceOf(source) {
		const record = recordOf(source);
		const kind = record === null ? null : stringOf(record.kind);
		if (kind === null) return {
			role: "inject",
			label: null
		};
		switch (kind) {
			case "session-reference": {
				const labels = collectStrings(record, "references", "label");
				return {
					role: "recall",
					label: labels !== null ? labels.join("、") : null
				};
			}
			case "agent-instructions": {
				const paths = collectStrings(record, "changes", "path");
				return {
					role: "inject",
					label: paths !== null ? paths.join("、") : null
				};
			}
			case "plugin": return {
				role: "inject",
				label: stringOf(record.plugin) ?? null
			};
			case "skill-invocation": return {
				role: "inject",
				label: stringOf(record.name) ?? null
			};
			default: return {
				role: "inject",
				label: null
			};
		}
	}
	function contextFormOf(source) {
		const record = recordOf(source);
		const form = record === null ? null : stringOf(record.form);
		return form !== null && Object.prototype.hasOwnProperty.call(CONTEXT_FORM_LABELS, form) ? form : null;
	}
	function resultTextOf(data) {
		const content = Array.isArray(data?.message?.content) ? data.message.content : null;
		const block = content !== null && content.length > 0 ? content[0] : null;
		if (block === null || block.type !== "tool-result") return "";
		return textOfBlocks(block.content);
	}
	function flushPartials(partials, messages, onRow) {
		const done = [];
		for (const p of partials.values()) {
			if (p.kind === "text" && p.text !== "") onRow({
				kind: "assistant",
				id: p.id,
				text: p.text
			}, p.stepKey);
			else if (p.kind === "reasoning" && p.text !== "") onRow({
				kind: "reasoning",
				id: p.id,
				text: p.text
			}, p.stepKey);
			else if (p.kind === "tool-call" && (p.name !== "" || p.args !== "")) onRow({
				kind: "tool",
				id: p.id,
				callId: p.callId ?? "",
				name: p.name,
				args: p.args,
				result: null,
				isError: false,
				done: false
			}, p.stepKey);
			done.push(p.id);
		}
		partials.clear();
		return done;
	}
	function foldTranscript(session) {
		const messages = [];
		const toolById = /* @__PURE__ */ new Map();
		const partialRowsByStep = /* @__PURE__ */ new Map();
		const partials = /* @__PURE__ */ new Map();
		const stepKeyOf = (data) => {
			const turn = data?.turn;
			const step = data?.step;
			return typeof turn === "number" && typeof step === "number" ? `${turn}:${step}` : null;
		};
		const markPartialRow = (stepKey, rowId) => {
			if (stepKey === null) return;
			let set = partialRowsByStep.get(stepKey);
			if (set === void 0) {
				set = /* @__PURE__ */ new Set();
				partialRowsByStep.set(stepKey, set);
			}
			set.add(rowId);
		};
		const removePartialRowsOf = (stepKey) => {
			const set = partialRowsByStep.get(stepKey);
			if (set === void 0 || set.size === 0) return;
			partialRowsByStep.delete(stepKey);
			for (let i = messages.length - 1; i >= 0; i--) if (set.has(messages[i].id)) messages.splice(i, 1);
		};
		const upsertToolRow = (callId, fields) => {
			if (typeof callId === "string" && callId !== "") {
				const existing = toolById.get(callId);
				if (existing !== void 0 && messages.includes(existing) && existing.kind === "tool") {
					if (typeof fields.name === "string" && fields.name !== "") existing.name = fields.name;
					if (typeof fields.args === "string" && fields.args !== "") existing.args = fields.args;
					return existing;
				}
				const row = {
					kind: "tool",
					id: `t${callId}`,
					callId,
					name: fields.name ?? "",
					args: fields.args ?? "",
					result: null,
					isError: false,
					done: false
				};
				toolById.set(callId, row);
				messages.push(row);
				return row;
			}
			const row = {
				kind: "tool",
				id: fields.id ?? `tp${messages.length}`,
				name: fields.name ?? "",
				args: fields.args ?? "",
				result: null,
				isError: false,
				done: false
			};
			messages.push(row);
			return row;
		};
		const pushRow = (row, stepKey) => {
			if (row.kind === "tool") {
				upsertToolRow(row.callId, {
					id: row.id,
					name: row.name,
					args: row.args
				});
				return;
			}
			messages.push(row);
			markPartialRow(stepKey, row.id);
		};
		let running = false;
		let lastSeq = 0;
		for (const ev of session.events ?? []) {
			const seq = typeof ev.seq === "number" ? ev.seq : 0;
			if (seq > lastSeq) lastSeq = seq;
			switch (ev.type) {
				case "user/message": {
					const source = ev.data?.source;
					if (recordOf(source) !== null && source.kind === "user") {
						const text = textOfBlocks(ev.data?.content);
						if (text !== "") messages.push({
							kind: "user",
							id: `u${seq}`,
							text
						});
					} else if (recordOf(source) !== null && source.kind !== "tool") {
						const text = textOfBlocks(ev.data?.content);
						const provenance = contextProvenanceOf(source);
						const form = contextFormOf(source);
						const row = {
							kind: "context",
							id: `c${seq}`,
							label: form !== null ? CONTEXT_FORM_LABELS[form] : provenance.role === "recall" ? "跨会话召回" : "上下文注入",
							producer: provenance.label ?? "",
							text,
							source
						};
						if (form === "notice" && stringOf(source.summary) !== null) row.summary = source.summary;
						messages.push(row);
					}
					break;
				}
				case "assistant/message": {
					const content = Array.isArray(ev.data?.message?.content) ? ev.data.message.content : null;
					if (content === null) break;
					removePartialRowsOf(stepKeyOf(ev.data));
					for (const block of content) {
						if (block === null || typeof block !== "object") continue;
						if (block.type === "text" && typeof block.text === "string" && block.text !== "") messages.push({
							kind: "assistant",
							id: `a${seq}`,
							text: block.text
						});
						else if (block.type === "reasoning" && typeof block.text === "string" && block.text !== "") messages.push({
							kind: "reasoning",
							id: `r${seq}`,
							text: block.text
						});
					}
					break;
				}
				case "assistant/chunk": {
					const chunk = ev.data?.chunk;
					if (chunk === null || typeof chunk !== "object") break;
					if (chunk.type === "block-start") {
						const kind = chunk.blockType === "text" || chunk.blockType === "reasoning" || chunk.blockType === "tool-call" ? chunk.blockType : "text";
						partials.set(chunk.index, {
							id: `p${seq}`,
							kind,
							text: "",
							name: "",
							args: "",
							callId: "",
							stepKey: stepKeyOf(ev.data)
						});
					} else if (chunk.type === "text-delta") {
						let p = partials.get(chunk.index);
						if (p === void 0) {
							p = {
								id: `p${seq}`,
								kind: "text",
								text: "",
								name: "",
								args: "",
								callId: "",
								stepKey: stepKeyOf(ev.data)
							};
							partials.set(chunk.index, p);
						}
						if (p.kind === "text") p.text += chunk.text ?? "";
					} else if (chunk.type === "reasoning-delta") {
						let p = partials.get(chunk.index);
						if (p === void 0) {
							p = {
								id: `p${seq}`,
								kind: "reasoning",
								text: "",
								name: "",
								args: "",
								callId: "",
								stepKey: stepKeyOf(ev.data)
							};
							partials.set(chunk.index, p);
						}
						if (p.kind === "reasoning") p.text += chunk.text ?? "";
					} else if (chunk.type === "tool-call-delta") {
						let p = partials.get(chunk.index);
						if (p === void 0) {
							p = {
								id: `p${seq}`,
								kind: "tool-call",
								text: "",
								name: "",
								args: "",
								callId: "",
								stepKey: stepKeyOf(ev.data)
							};
							partials.set(chunk.index, p);
						}
						if (p.kind === "tool-call") {
							if (chunk.id !== void 0 && typeof chunk.id === "string" && chunk.id !== "") p.callId = chunk.id;
							if (chunk.name !== void 0 && typeof chunk.name === "string" && chunk.name !== "") p.name = chunk.name;
							p.args += chunk.argumentsDelta ?? "";
						}
					} else if (chunk.type === "block-end") {
						const p = partials.get(chunk.index);
						if (p !== void 0) {
							partials.delete(chunk.index);
							if (p.kind === "text" && p.text !== "") pushRow({
								kind: "assistant",
								id: p.id,
								text: p.text
							}, p.stepKey);
							else if (p.kind === "reasoning" && p.text !== "") pushRow({
								kind: "reasoning",
								id: p.id,
								text: p.text
							}, p.stepKey);
							else if (p.kind === "tool-call" && (p.name !== "" || p.args !== "")) pushRow({
								kind: "tool",
								id: p.id,
								callId: p.callId ?? "",
								name: p.name,
								args: p.args,
								result: null,
								isError: false,
								done: false
							}, p.stepKey);
						}
					}
					break;
				}
				case "tool/call": {
					const callId = typeof ev.data?.callId === "string" ? ev.data.callId : null;
					if (callId === null || callId === "") break;
					upsertToolRow(callId, {
						name: typeof ev.data.name === "string" ? ev.data.name : "",
						args: typeof ev.data.arguments === "string" ? ev.data.arguments : ""
					});
					break;
				}
				case "tool/result": {
					const data = ev.data ?? {};
					const block = Array.isArray(data.message?.content) && data.message.content.length > 0 ? data.message.content[0] : null;
					const callId = block !== null && block.type === "tool-result" && typeof block.toolCallId === "string" ? block.toolCallId : recordOf(data.message?.source) !== null && typeof data.message.source.callId === "string" ? data.message.source.callId : null;
					const row = callId !== null ? toolById.get(callId) : void 0;
					const resultText = resultTextOf(data);
					const isError = block !== null && block.isError === true || data.error !== void 0;
					if (row !== void 0 && messages.includes(row) && row.kind === "tool") {
						row.result = resultText;
						row.isError = isError;
						row.done = true;
					} else if (resultText !== "") messages.push({
						kind: "tool",
						id: `tr${seq}`,
						name: "",
						args: "",
						result: resultText,
						isError,
						done: true
					});
					break;
				}
				case "step/end":
				case "turn/end":
					if (ev.type === "turn/end") {
						running = false;
						const reason = recordOf(ev.data?.reason);
						if (reason !== null && reason.kind === "error" && recordOf(reason.error) !== null) {
							const message = stringOf(reason.error.message);
							if (message !== null) {
								const code = stringOf(reason.error.code);
								messages.push({
									kind: "turn-error",
									id: `te${seq}`,
									text: message,
									...code === null ? {} : { code }
								});
							}
						}
					}
					flushPartials(partials, messages, pushRow);
					break;
				case "turn/start":
					running = true;
					break;
				default: break;
			}
		}
		const trimmed = messages.slice(-200);
		const livePartials = [];
		for (const p of partials.values()) if (p.kind === "text" && p.text !== "") livePartials.push({
			kind: "assistant",
			id: p.id,
			text: p.text
		});
		else if (p.kind === "reasoning" && p.text !== "") livePartials.push({
			kind: "reasoning",
			id: p.id,
			text: p.text
		});
		else if (p.kind === "tool-call" && (p.name !== "" || p.args !== "")) livePartials.push({
			kind: "tool",
			id: p.id,
			...p.callId === "" ? {} : { callId: p.callId },
			name: p.name,
			args: p.args,
			result: null,
			isError: false,
			done: false
		});
		return {
			lastSeq,
			running,
			partials: livePartials,
			messages: trimmed
		};
	}
	function currentModelOf(id, agent) {
		const override = overrides.get(id);
		if (override !== void 0) return {
			provider: override.provider,
			model: override.model,
			...override.effort === void 0 ? {} : { effort: override.effort }
		};
		try {
			const config = (typeof agent.session.requestHeader === "function" ? agent.session.requestHeader() : void 0)?.config;
			if (config && typeof config.provider === "string" && typeof config.model === "string") return {
				provider: config.provider,
				model: config.model,
				...config.reasoningEffort === void 0 ? {} : { effort: config.reasoningEffort }
			};
		} catch {}
		const selection = defaultSelection();
		if (selection !== void 0) {
			let effort;
			try {
				effort = agentDefaultModel?.currentSelection?.()?.reasoningEffort;
			} catch {}
			return {
				provider: selection.provider,
				model: selection.model,
				...effort === void 0 ? {} : { effort }
			};
		}
	}
	async function buildCatalog() {
		try {
			const providers = await llm.listProviders();
			const out = [];
			for (const provider of providers) {
				const providerId = typeof provider === "string" ? provider : provider.id;
				const providerName = typeof provider === "string" ? provider : provider.name ?? provider.id;
				const models = await llm.listModels(providerId);
				const entries = [];
				for (const model of models) {
					const modelId = typeof model === "string" ? model : model.id;
					const modelName = typeof model === "string" ? model : model.name ?? model.id;
					let reasoning;
					try {
						const info = await llm.resolveModelInfo(providerId, modelId);
						if (info?.reasoning) reasoning = {
							efforts: (info.reasoning.efforts ?? []).map((entry) => ({
								id: entry.id,
								name: entry.name
							})),
							...info.reasoning.defaultEffort === void 0 ? {} : { defaultEffort: info.reasoning.defaultEffort }
						};
					} catch {}
					entries.push({
						id: modelId,
						name: modelName,
						...reasoning === void 0 ? {} : { reasoning }
					});
				}
				out.push({
					id: providerId,
					name: providerName,
					models: entries
				});
			}
			return out;
		} catch (error) {
			ctx.logger.warn(`[dsh-notes] model catalog failed: ${String(error)}`);
			return [];
		}
	}
	async function roster() {
		try {
			return (await agentPresets.list()).map((row) => ({
				id: row.id,
				...row.name === void 0 ? {} : { name: row.name },
				trust: row.trust,
				isDefault: row.isDefault === true,
				...row.broken === true ? { broken: true } : {}
			}));
		} catch (error) {
			ctx.logger.warn(`[dsh-notes] preset roster failed: ${String(error)}`);
			return [];
		}
	}
	async function scardState() {
		const id = await ensureResident();
		if (id === null) return {
			ok: false,
			error: "scard-unavailable"
		};
		let agent;
		try {
			agent = agents.get(id) ?? await resumeAgent(id);
		} catch (error) {
			return {
				ok: false,
				error: {
					code: "resume-failed",
					message: String(error?.message ?? error)
				}
			};
		}
		const session = agent.session;
		const blank = !session.events.some((ev) => ev.type === "turn/start");
		let presetId;
		try {
			presetId = agentPresets.composedPreset(agent.ctx)?.id;
		} catch {}
		presetId ??= foldedPresetOf(session);
		const [catalog, presets] = await Promise.all([buildCatalog(), roster()]);
		return {
			ok: true,
			scard: {
				sessionId: id,
				title: "常驻会话",
				blank,
				running: isRunning(session),
				presetId,
				presetLocked: !blank,
				presets,
				model: currentModelOf(id, agent),
				catalog
			}
		};
	}
	async function scardChatState() {
		const id = await ensureResident();
		if (id === null) return {
			ok: false,
			error: "scard-unavailable"
		};
		const agent = agents.get(id);
		if (agent === void 0) return {
			ok: true,
			scard: { cold: true }
		};
		return {
			ok: true,
			scard: {
				sessionId: id,
				...foldTranscript(agent.session)
			}
		};
	}
	async function scardSelectPreset() {
		if (await ensureResident() === null) return {
			ok: false,
			error: "scard-unavailable"
		};
		return {
			ok: false,
			error: {
				code: "locked",
				message: "常驻会话预设已固定为 resident（禁用弹窗交互工具），不可切换"
			}
		};
	}
	async function scardSelectModel(body) {
		const id = await ensureResident();
		if (id === null) return {
			ok: false,
			error: "scard-unavailable"
		};
		const provider = typeof body.provider === "string" ? body.provider : "";
		const model = typeof body.model === "string" ? body.model : "";
		if (provider === "" || model === "") return {
			ok: false,
			error: {
				code: "bad-args",
				message: "provider/model required"
			}
		};
		const effort = body.effort === void 0 || body.effort === null || body.effort === "" ? void 0 : body.effort;
		try {
			await llm.resolveCallConfig({
				provider,
				model,
				...effort === void 0 ? {} : { reasoningEffort: effort }
			});
		} catch (error) {
			return {
				ok: false,
				error: {
					code: "model-unavailable",
					message: String(error?.message ?? error)
				}
			};
		}
		overrides.set(id, {
			provider,
			model,
			...effort === void 0 ? {} : { effort }
		});
		residentSettings.provider = provider;
		residentSettings.model = model;
		if (effort === void 0) delete residentSettings.effort;
		else residentSettings.effort = effort;
		await writeStateFile(id, residentSettings);
		if (agentDefaultModel !== void 0 && typeof agentDefaultModel.saveSelection === "function") try {
			await agentDefaultModel.saveSelection({
				provider,
				model,
				...effort === void 0 ? {} : { reasoningEffort: effort }
			});
		} catch (error) {
			ctx.logger.warn(`[dsh-notes] saveSelection failed: ${String(error)}`);
		}
		return {
			ok: true,
			selected: {
				provider,
				model,
				...effort === void 0 ? {} : { effort }
			}
		};
	}
	async function scardClear() {
		const id = await ensureResident();
		if (id === null) return {
			ok: false,
			error: "scard-unavailable"
		};
		const agent = agents.get(id);
		if (agent !== void 0 && agent.status === "running") return {
			ok: false,
			error: {
				code: "running",
				message: "会话运行中，不能清空"
			}
		};
		try {
			if (workspaceRegistry !== void 0) await workspaceRegistry.archiveSession(id);
		} catch (error) {
			ctx.logger.warn(`[dsh-notes] archiveSession failed: ${String(error)}`);
		}
		overrides.delete(id);
		revisions.delete(id);
		const newId = await createResident();
		residentIdRef.current = newId;
		residentPromise = null;
		return {
			ok: true,
			sessionId: newId
		};
	}
	return {
		enabled: true,
		handle(action, body) {
			switch (action) {
				case "scard-state": return scardState();
				case "scard-chat-state": return scardChatState();
				case "scard-select-preset": return scardSelectPreset(body);
				case "scard-select-model": return scardSelectModel(body);
				case "scard-clear": return scardClear();
				default: return Promise.resolve({
					ok: false,
					error: {
						code: "unknown-action",
						message: action
					}
				});
			}
		}
	};
}
function readJson(req) {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > 256 * 1024) {
				reject(/* @__PURE__ */ new Error("payload too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch (error) {
				reject(error);
			}
		});
		req.on("error", reject);
	});
}
//#endregion
export { apply, inject, name };
