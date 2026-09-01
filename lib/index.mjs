//#region src/index.mjs
const name = "dsh-notes";
const inject = ["webServer", "storageDomain"];
const TODO_TEXT_MAX = 500;
const DETAIL_MAX = 2e4;
const MEMO_MAX = 2e4;
const ROUTE_PATH = "/api/dsh-notes";
const UNDO_CAP = 100;
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
	const storageDomain = ctx.storageDomain;
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
