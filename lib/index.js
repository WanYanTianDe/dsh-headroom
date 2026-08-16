import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import { BasicCompactionEngine } from "@deepseek-ai/dsh-compaction-basic";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { freezeMessage } from "@deepseek-ai/dsh-llm";

//#region src/format.ts
/** Convert a DSH summarization input to the OpenAI message shape. */
function toOpenAiMessages(input) {
	const messages = [];
	if (input.system !== void 0 && input.system.length > 0) messages.push({
		role: "system",
		content: input.system
	});
	for (const message$2 of input.messages) messages.push(...messageToOpenAi(message$2));
	return messages;
}
function messageToOpenAi(message$2) {
	const toolResults = message$2.content.filter((block) => block.type === "tool-result");
	if (toolResults.length > 0) return toolResults.map((block) => ({
		role: "tool",
		tool_call_id: block.toolCallId,
		content: blocksToText(block.content)
	}));
	if (message$2.role === "assistant") {
		const toolCalls = message$2.content.filter((block) => block.type === "tool-call");
		if (toolCalls.length > 0) return [{
			role: "assistant",
			content: blocksToText(message$2.content.filter((block) => block.type !== "tool-call")),
			tool_calls: toolCalls.map((block) => ({
				id: block.id,
				type: "function",
				function: {
					name: block.name,
					arguments: block.arguments
				}
			}))
		}];
	}
	return [{
		role: message$2.role,
		content: blocksToText(message$2.content)
	}];
}
function blocksToText(blocks) {
	return blocks.map(blockToText).filter((text) => text.length > 0).join("\n");
}
function blockToText(block) {
	switch (block.type) {
		case "text": return block.text;
		case "reasoning": return "";
		case "image": return "[image]";
		case "tool-call": return JSON.stringify({
			id: block.id,
			name: block.name,
			arguments: block.arguments
		});
		case "tool-result": return blocksToText(block.content);
		default: return JSON.stringify(block);
	}
}
/** Render compressed wire messages as the checkpoint summary text. */
function renderCheckpointText(response) {
	const lines = response.messages.map((message$2) => renderWireMessage(message$2));
	const remaining = Math.round(response.compression_ratio * 100);
	const header = `[compressed by headroom: ${response.tokens_before} → ${response.tokens_after} tokens (${remaining}% of original)]`;
	const ccr = response.ccr_hashes.length > 0 ? `\nOriginal content is retrievable via the headroom_retrieve tool with one of these hashes: ${response.ccr_hashes.join(", ")}` : "";
	return `${header}\n\n${lines.join("\n\n")}${ccr}`;
}
function renderWireMessage(message$2) {
	const content = typeof message$2.content === "string" ? message$2.content : JSON.stringify(message$2.content ?? null);
	const call = message$2.tool_call_id === void 0 ? "" : ` (tool ${message$2.tool_call_id})`;
	return `[${message$2.role}${call}]\n${content}`;
}

//#endregion
//#region src/engine.ts
var HeadroomCompactionEngine = class extends BasicCompactionEngine {
	static inject = [
		"llm",
		"tokenMeter",
		"sessions"
	];
	constructor(ctx, config = {}) {
		const { model,...base } = config;
		super(ctx, base);
		this.headroomModel = model;
	}
	/**
	
	* Condense the replayed conversation region through the local proxy instead
	
	* of a paid LLM summarization call. The compressed message list is rendered
	
	* as text so the inherited checkpoint transaction can frame it.
	
	*/
	async summarize(input, agent, signal) {
		signal?.throwIfAborted();
		const client = this.ctx.headroomClient;
		if (client === void 0) throw new Error("dsh-headroom: headroom service is not ready; compaction deferred until the proxy responds");
		const model = this.headroomModel ?? routedModel(agent);
		const response = await client.compress(toOpenAiMessages(input), model);
		signal?.throwIfAborted();
		const text = renderCheckpointText(response);
		if (text.trim().length === 0) throw new Error("dsh-headroom: compression produced no output");
		return {
			summary: [{
				type: "text",
				text
			}],
			provider: "headroom",
			model: model ?? "headroom-proxy"
		};
	}
};
/** The conversation's routed model, when the session has one. */
function routedModel(agent) {
	const header = agent.session.requestHeader()?.config;
	if (header !== void 0 && header.model.length > 0) return header.model;
	if (agent.options.model !== void 0 && agent.options.model.length > 0) return agent.options.model;
	return void 0;
}

//#endregion
//#region src/client.ts
var HeadroomClient = class {
	constructor(baseUrl, timeoutMs = 3e4) {
		this.baseUrl = baseUrl;
		this.timeoutMs = timeoutMs;
	}
	/** Whether the proxy answers /health successfully right now. */
	async health() {
		try {
			const response = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(2e3) });
			return response.ok;
		} catch {
			return false;
		}
	}
	/**
	
	* Compress an OpenAI-style message list through the local proxy. The proxy
	
	* requires the `model` field for token estimation; callers may pass the
	
	* conversation's routed model, and the harness default stands in when they
	
	* have none.
	
	*/
	async compress(messages, model = "deepseek-chat") {
		const body = {
			messages,
			model
		};
		const response = await fetch(`${this.baseUrl}/v1/compress`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(this.timeoutMs)
		});
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			throw new Error(`headroom /v1/compress failed: HTTP ${response.status} ${detail}`);
		}
		return await response.json();
	}
	/** Restore original content from the CCR store by its hash. */
	async retrieve(hash) {
		const response = await fetch(`${this.baseUrl}/v1/retrieve`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ hash }),
			signal: AbortSignal.timeout(this.timeoutMs)
		});
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			throw new Error(`headroom /v1/retrieve failed: HTTP ${response.status} ${detail}`);
		}
		return response.json();
	}
};

//#endregion
//#region src/service.ts
const DEFAULT_HEADROOM_PORT = 8787;
function resolveServiceConfig(config) {
	const port = config?.port ?? DEFAULT_HEADROOM_PORT;
	return {
		baseUrl: config?.baseUrl ?? `http://127.0.0.1:${port}`,
		port,
		command: config?.command,
		pythonPath: config?.pythonPath,
		uvCommand: config?.uvCommand,
		autoInstall: config?.autoInstall ?? true,
		installTimeoutMs: config?.installTimeoutMs ?? 10 * 6e4,
		startTimeoutMs: config?.startTimeoutMs ?? 6e4
	};
}
/**

* Resolve how to launch the proxy: an explicit `pythonPath` runs the headroom

* CLI module under that interpreter; otherwise the headroom executable is

* discovered.

*/
async function resolveLaunch(ctx, config) {
	if (config.pythonPath !== void 0 && config.pythonPath.length > 0) {
		const py = findExecutable(config.pythonPath);
		if (py !== void 0) {
			const cliOk = probeModule(py, [
				"-m",
				"headroom.cli",
				"--version"
			]);
			if (cliOk) {
				ctx.logger.info("dsh-headroom: using python %s (-m headroom.cli)", py);
				return {
					command: py,
					prefix: ["-m", "headroom.cli"]
				};
			}
			const pkgOk = probeModule(py, [
				"-m",
				"headroom",
				"--version"
			]);
			if (pkgOk) {
				ctx.logger.info("dsh-headroom: using python %s (-m headroom)", py);
				return {
					command: py,
					prefix: ["-m", "headroom"]
				};
			}
			ctx.logger.warn("dsh-headroom: pythonPath %s cannot run headroom as a module; falling back to command discovery", config.pythonPath);
		} else ctx.logger.warn("dsh-headroom: pythonPath %s not found; falling back to command discovery", config.pythonPath);
	}
	const command = findExecutable(config.command) ?? findOnPath("headroom") ?? uvToolBin("headroom");
	if (command !== void 0) return {
		command,
		prefix: []
	};
	return void 0;
}
/** Probe one `python -m <module>` invocation; only a clean exit 0 means yes. */
function probeModule(py, args) {
	try {
		const probe = spawnSync(py, args, {
			stdio: "ignore",
			timeout: 5e3,
			shell: false
		});
		return probe.error === void 0 && probe.status === 0;
	} catch {
		return false;
	}
}
/**

* Bring the proxy up: reuse a healthy service, else discover or auto-install

* the command, spawn it, and wait for health. Never throws — failures degrade

* to a disabled compression backend with a logged reason.

*/
async function startHeadroomService(ctx, config) {
	const client = new HeadroomClient(config.baseUrl);
	if (await client.health()) {
		ctx.logger.info("dsh-headroom: reusing headroom proxy at %s", config.baseUrl);
		return {
			client,
			dispose: () => {},
			reused: true
		};
	}
	let launch = await resolveLaunch(ctx, config);
	if (launch === void 0 && config.autoInstall) {
		const py = config.pythonPath !== void 0 && config.pythonPath.length > 0 ? findExecutable(config.pythonPath) : void 0;
		if (py !== void 0) {
			ctx.logger.info("dsh-headroom: installing headroom-ai into %s via pip (first run)…", py);
			try {
				await runAndWait(py, [
					"-m",
					"pip",
					"install",
					"headroom-ai[all]"
				], config.installTimeoutMs);
			} catch (error) {
				ctx.logger.warn("dsh-headroom: pip auto-install failed: %s", errorMessage(error));
			}
			launch = await resolveLaunch(ctx, config);
		} else {
			const uv = findExecutable(config.uvCommand) ?? findOnPath("uv") ?? wingetUv();
			if (uv === void 0) {
				ctx.logger.warn("dsh-headroom: headroom not found and uv is not installed; install it with `uv tool install \"headroom-ai[all]\"` (install uv first if needed)");
				return {
					client: void 0,
					dispose: () => {},
					reused: false
				};
			}
			ctx.logger.info("dsh-headroom: installing headroom-ai via uv (first run)…");
			try {
				await runAndWait(uv, [
					"tool",
					"install",
					"--python",
					"3.13",
					"headroom-ai[all]"
				], config.installTimeoutMs);
			} catch (error) {
				ctx.logger.warn("dsh-headroom: auto-install failed: %s", errorMessage(error));
				return {
					client: void 0,
					dispose: () => {},
					reused: false
				};
			}
			launch = await resolveLaunch(ctx, config);
		}
	}
	if (launch === void 0) {
		ctx.logger.warn("dsh-headroom: headroom command not found; compression disabled. Install it with `uv tool install \"headroom-ai[all]\"`, set config.headroom.command, or set config.headroom.pythonPath to a Python that has headroom-ai installed.");
		return {
			client: void 0,
			dispose: () => {},
			reused: false
		};
	}
	const child = spawn(launch.command, [
		...launch.prefix,
		"proxy",
		"--port",
		String(config.port)
	], {
		stdio: "ignore",
		windowsHide: true
	});
	child.on("error", (error) => ctx.logger.warn("dsh-headroom: proxy failed to start: %s", errorMessage(error)));
	child.on("exit", (code) => ctx.logger.warn("dsh-headroom: proxy exited early with code %s", String(code)));
	const deadline = Date.now() + config.startTimeoutMs;
	while (Date.now() < deadline) {
		if (await client.health()) {
			ctx.logger.info("dsh-headroom: proxy ready at %s", config.baseUrl);
			return {
				client,
				dispose: () => killProcessTree(child),
				reused: false
			};
		}
		await sleep(500);
	}
	ctx.logger.warn("dsh-headroom: proxy did not become healthy within %sms; compression disabled", config.startTimeoutMs);
	killProcessTree(child);
	return {
		client: void 0,
		dispose: () => {},
		reused: false
	};
}
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
/** Resolve one explicit executable candidate; a leading `~` expands to the home directory. */
function findExecutable(candidate) {
	if (candidate === void 0 || candidate.length === 0) return void 0;
	const expanded = candidate === "~" || candidate.startsWith("~/") || candidate.startsWith("~\\") ? join(homedir(), candidate.slice(1)) : candidate;
	if (existsSync(expanded)) return expanded;
	if (process.platform === "win32" && existsSync(`${expanded}.exe`)) return `${expanded}.exe`;
	return void 0;
}
/** Resolve a bare command name through the process PATH. */
function findOnPath(name$1) {
	const probe = spawnSync(name$1, ["--version"], {
		stdio: "ignore",
		timeout: 3e3,
		shell: false
	});
	return probe.error === void 0 && probe.status !== null ? name$1 : void 0;
}
/** uv tool installs land in ~/.local/bin by default. */
function uvToolBin(name$1) {
	const binDir = process.env.UV_TOOL_BIN_DIR;
	const base = binDir !== void 0 && binDir.length > 0 ? binDir : join(homedir(), ".local", "bin");
	const candidate = join(base, name$1);
	return findExecutable(candidate);
}
/** Locate a winget-installed uv (the astral-sh.uv package layout). */
function wingetUv() {
	if (process.platform !== "win32") return void 0;
	const packagesDir = join(homedir(), "AppData", "Local", "Microsoft", "WinGet", "Packages");
	if (!existsSync(packagesDir)) return void 0;
	for (const entry of readdirSync(packagesDir)) {
		if (!entry.startsWith("astral-sh.uv")) continue;
		const candidate = join(packagesDir, entry, "uv.exe");
		if (existsSync(candidate)) return candidate;
	}
	return void 0;
}
/** Run one command to completion, rejecting on non-zero exit or timeout. */
function runAndWait(command, args, timeoutMs) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: [
				"ignore",
				"ignore",
				"pipe"
			],
			windowsHide: true
		});
		let stderr = "";
		child.stderr?.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error(`${command} timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("exit", (code) => {
			clearTimeout(timer);
			if (code === 0) resolve();
			else reject(new Error(`${command} exited with ${String(code)}: ${stderr.slice(-2e3)}`));
		});
	});
}
/** Terminate the child and (on Windows) its process tree. */
function killProcessTree(child) {
	if (child.pid === void 0) return;
	if (process.platform === "win32") try {
		spawnSync("taskkill", [
			"/pid",
			String(child.pid),
			"/T",
			"/F"
		], { stdio: "ignore" });
	} catch {}
	child.kill();
}

//#endregion
//#region src/result-compressor.ts
/** Prefix marking a headroom-compressed tool result; scanners skip these. */
const COMPRESSED_RESULT_PREFIX = "[compressed by headroom";
/** Default tool-result compression policy. */
const RESULT_COMPRESSION_DEFAULTS = {
	enabled: true,
	thresholdChars: 8192,
	minSavingsRatio: .15,
	maxPerStep: 3
};
/** Merge partial configuration over the defaults. */
function resolveResultCompression(config) {
	return {
		enabled: config?.enabled ?? RESULT_COMPRESSION_DEFAULTS.enabled,
		thresholdChars: config?.thresholdChars ?? RESULT_COMPRESSION_DEFAULTS.thresholdChars,
		minSavingsRatio: config?.minSavingsRatio ?? RESULT_COMPRESSION_DEFAULTS.minSavingsRatio,
		maxPerStep: config?.maxPerStep ?? RESULT_COMPRESSION_DEFAULTS.maxPerStep
	};
}
/** Text length in Unicode code points; non-text blocks cost zero. */
function measureText(blocks) {
	let chars = 0;
	for (const block of blocks) if (block.type === "text") chars += Array.from(block.text).length;
	return chars;
}
/** Whether content carries the headroom compression marker on its first block. */
function isCompressedResult(blocks) {
	const first = blocks[0];
	return first?.type === "text" && first.text.startsWith(COMPRESSED_RESULT_PREFIX);
}
/**
* Collect over-budget, uncompressed tool-result surface nodes in surface
* order. Nodes below the threshold or already carrying the compression
* marker are skipped, so a pass never re-compresses its own output.
* @param session - session whose current surface is scanned.
* @param thresholdChars - minimum text length (code points) that qualifies.
* @returns candidate surface nodes in surface order.
*/
function scanResultCandidates(session, thresholdChars) {
	const candidates = [];
	for (const seq of [...session.surface.nodes]) {
		const event = session.events[seq];
		if (event?.type !== "tool/result") continue;
		const result = event.data.message.content[0];
		if (result === void 0) continue;
		if (isCompressedResult(result.content)) continue;
		if (measureText(result.content) < thresholdChars) continue;
		candidates.push({
			seq,
			event
		});
	}
	return candidates;
}
/**
* Whether a compression is worth replacing the original: the proxy must
* report enough token savings to justify losing the verbatim text.
* @param tokensBefore - proxy-reported token count of the original.
* @param tokensAfter - proxy-reported token count of the compressed result.
* @param minSavingsRatio - required minimum saved fraction (0..1).
* @returns true when the replacement is strictly smaller than the budget.
*/
function shouldReplace(tokensBefore, tokensAfter, minSavingsRatio) {
	if (tokensBefore <= 0) return false;
	return tokensAfter < tokensBefore * (1 - minSavingsRatio);
}
/**
* Render the compressed tool-result text: a retrieval header carrying the
* token accounting and the CCR hashes, then the compressed content.
* @param text - compressed tool-result text from the proxy.
* @param tokensBefore - proxy-reported token count of the original.
* @param tokensAfter - proxy-reported token count of the compressed result.
* @param ccrHashes - CCR store hashes; original content is retrievable with them.
* @returns the replacement text block content.
*/
function renderCompressedResult(text, tokensBefore, tokensAfter, ccrHashes) {
	const remaining = tokensBefore > 0 ? Math.round(tokensAfter / tokensBefore * 100) : 0;
	const ccr = ccrHashes.length > 0 ? ` Original retrievable via the headroom_retrieve tool with one of these hashes: ${ccrHashes.join(", ")}.` : "";
	return `${COMPRESSED_RESULT_PREFIX}: ${tokensBefore} → ${tokensAfter} tokens (${remaining}% of original).${ccr}]\n${text}`;
}
/** Extract the compressed text from a proxy compress response. */
function compressedText(response) {
	const message$2 = response.messages[0];
	if (typeof message$2 !== "object" || message$2 === null) return void 0;
	const content = message$2.content;
	return typeof content === "string" && content.length > 0 ? content : void 0;
}
/** The tool-result message's single result block, when present. */
function resultBlock(message$2) {
	const block = message$2.content[0];
	return block?.type === "tool-result" ? block : void 0;
}
/**
* Compress the over-budget tool results of one session through the proxy,
* replacing each qualified node with a headroom-compressed text block via the
* shared shadow-price protocol. Skips nodes the proxy cannot compress or that
* fail the savings test; earlier replacements stay durable when a later one
* fails.
* @param ctx - context providing the token meter for shadow pricing.
* @param client - healthy headroom proxy client.
* @param agent - agent owning the session; its routed model reports to the proxy.
* @param session - session whose current surface is rewritten.
* @param config - resolved tool-result compression policy.
* @param signal - cancellation; a pass aborts between candidates.
* @returns landed replacements with token accounting.
*/
async function compressSessionResults(ctx, client, agent, session, config, signal) {
	const candidates = scanResultCandidates(session, config.thresholdChars).slice(0, config.maxPerStep);
	const outcomes = [];
	for (const { seq, event } of candidates) {
		signal?.throwIfAborted();
		const message$2 = event.data.message;
		const result = resultBlock(message$2);
		if (result === void 0) continue;
		const text = result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
		if (text.length === 0) continue;
		const model = routedModel(agent) ?? "deepseek-chat";
		const response = await client.compress([{
			role: "tool",
			tool_call_id: result.toolCallId,
			content: text
		}], model);
		signal?.throwIfAborted();
		const compressed = compressedText(response);
		if (compressed === void 0) continue;
		if (!shouldReplace(response.tokens_before, response.tokens_after, config.minSavingsRatio)) continue;
		const replaced = renderCompressedResult(compressed, response.tokens_before, response.tokens_after, response.ccr_hashes);
		const replacement = freezeMessage({
			...message$2,
			content: [{
				...result,
				content: [{
					type: "text",
					text: replaced
				}]
			}]
		});
		session.append("compaction/prune", {
			shadowedRange: {
				start: seq,
				end: seq
			},
			shadowedSeqs: [seq],
			shadowedTokenCount: ctx.tokenMeter.estimateMessage(message$2)
		});
		const replacementEvent = session.append("tool/result", {
			...event.data,
			message: replacement
		}, {
			surfaceOp: {
				op: "replace",
				start: seq,
				end: seq
			},
			sourceEventSeqs: [seq]
		});
		outcomes.push({
			seq,
			replacementSeq: replacementEvent.seq,
			tokensBefore: response.tokens_before,
			tokensAfter: response.tokens_after
		});
	}
	return outcomes;
}
/**
* Install the per-step tool-result compression listener. Runs before the
* historical compaction pass so the surface it prices is already slimmed.
* Skips silently when the proxy is unavailable or the live config disables
* compression; a failed pass degrades to the original content.
* @param ctx - plugin context.
* @param resolveConfig - live policy resolver, read at every step boundary so
* settings changes apply without a restart.
*/
function installResultCompression(ctx, resolveConfig) {
	ctx.on("agent/pre-step", async ({ agent, signal }, next) => {
		const config = resolveConfig();
		const client = ctx.headroomClient;
		if (config.enabled && client !== void 0 && !signal.aborted) try {
			const outcomes = await compressSessionResults(ctx, client, agent, agent.session, config, signal);
			if (outcomes.length > 0) {
				const before = outcomes.reduce((sum, outcome) => sum + outcome.tokensBefore, 0);
				const after = outcomes.reduce((sum, outcome) => sum + outcome.tokensAfter, 0);
				ctx.logger.info("dsh-headroom: compressed %d tool result(s) (%d → %d tokens)", outcomes.length, before, after);
			}
		} catch (error) {
			ctx.logger.warn("dsh-headroom: tool-result compression failed: %s", message$1(error));
		}
		return next();
	});
}
function message$1(error) {
	return error instanceof Error ? error.message : String(error);
}

//#endregion
//#region src/index.ts
const name = "dsh-headroom";
/** Services the plugin and its compaction engine read through the context. */
const inject = [
	"settings",
	"tools",
	"llm",
	"tokenMeter",
	"sessions"
];
const serviceConfigSchema = z.object({
	baseUrl: z.string(),
	port: z.number().step(1).min(1).max(65535),
	command: z.string(),
	pythonPath: z.string(),
	uvCommand: z.string(),
	autoInstall: z.boolean(),
	installTimeoutMs: z.number().step(1).min(1e3),
	startTimeoutMs: z.number().step(1).min(1e3)
});
const Config = z.object({
	headroom: serviceConfigSchema,
	model: z.string(),
	thresholdRatio: z.number(),
	retainRatio: z.number(),
	retainTokens: z.number().step(1).min(0),
	compactionRetries: z.number().step(1).min(0),
	maxOverflowRetries: z.number().step(1).min(0),
	auto: z.boolean(),
	resultCompression: z.object({
		enabled: z.boolean(),
		thresholdChars: z.number().step(1).min(1),
		minSavingsRatio: z.number(),
		maxPerStep: z.number().step(1).min(1)
	})
});
/** Settings namespace shared with the browser card. */
const HEADROOM_SETTINGS_NS = settingsNamespace("headroom");
const headroomSettingsSchema = z.object({
	command: z.string(),
	pythonPath: z.string(),
	uvCommand: z.string(),
	port: z.number().step(1).min(1).max(65535),
	baseUrl: z.string(),
	autoInstall: z.boolean(),
	resultCompressionEnabled: z.boolean(),
	resultCompressionThresholdChars: z.number().step(1).min(1)
});
/** Every key BasicCompactionEngine's config validation accepts. */
const BASIC_CONFIG_KEYS = [
	"thresholdRatio",
	"retainRatio",
	"retainTokens",
	"summarizationProvider",
	"summarizationModel",
	"maxTokens",
	"compactionRetries",
	"maxOverflowRetries",
	"modelPolicies",
	"auto"
];
function engineConfig(config) {
	const engine = {};
	if (config.model !== void 0) engine.model = config.model;
	for (const key of BASIC_CONFIG_KEYS) {
		const value = config[key];
		if (value !== void 0) engine[key] = value;
	}
	return engine;
}
function apply(ctx, config) {
	ctx.provide("headroomClient", void 0);
	const scope = ctx.settings.register(HEADROOM_SETTINGS_NS, headroomSettingsSchema, {
		base: {
			command: config.headroom?.command ?? "",
			pythonPath: config.headroom?.pythonPath ?? "",
			uvCommand: config.headroom?.uvCommand ?? "",
			port: config.headroom?.port ?? DEFAULT_HEADROOM_PORT,
			baseUrl: config.headroom?.baseUrl ?? "",
			autoInstall: config.headroom?.autoInstall ?? true
		},
		applies: "live"
	});
	installProxyLifecycle(ctx, scope);
	installResultCompression(ctx, () => liveResultConfig(scope, config));
	installEngine(ctx, config);
	installTakeoverRollback(ctx);
	ctx.effect(() => ctx.tools.register(defineTool({
		name: "headroom_retrieve",
		description: "Restore original content that the Headroom compression proxy replaced with a compacted checkpoint. Pass the exact ccr hash listed in a <compacted-summary> block of the conversation; returns the original tool output or message text.",
		parameters: { hash: {
			type: "string",
			description: "CCR hash shown in the compacted checkpoint."
		} },
		output: {
			schema: { type: "json" },
			render(_args, value) {
				const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
				return [{
					type: "text",
					text
				}];
			}
		},
		async execute(args) {
			const client = ctx.headroomClient;
			if (client === void 0) throw new Error("headroom service is not ready: no proxy is reachable");
			return await client.retrieve(args.hash);
		}
	})), "dsh-headroom: tool");
}
/**

* Result-compression policy resolved at a step boundary: settings values

* override the composition layer, which itself defaults over the baked-in

* policy defaults.

*/
function liveResultConfig(scope, config) {
	const base = resolveResultCompression(config.resultCompression);
	const settings = scope.get();
	return {
		...base,
		enabled: settings.resultCompressionEnabled ?? base.enabled,
		thresholdChars: settings.resultCompressionThresholdChars ?? base.thresholdChars
	};
}
/**

* Run the proxy lifecycle off the settings namespace: start once, restart on

* every settings change, and dispose on plugin unload. Restarts are serialized

* so an older spawn can never be killed by the newer restart that reused it,

* and proxy ownership follows the restart that actually spawned it.

*/
function installProxyLifecycle(ctx, scope) {
	ctx.effect(() => {
		let current;
		let generation = 0;
		let queue = Promise.resolve();
		let lastLaunchKey = "";
		const restart = () => {
			queue = queue.then(async () => {
				const id = ++generation;
				const settings = scope.get();
				const launchKey = JSON.stringify({
					command: settings.command ?? null,
					pythonPath: settings.pythonPath ?? null,
					uvCommand: settings.uvCommand ?? null,
					port: settings.port ?? null,
					baseUrl: settings.baseUrl ?? null,
					autoInstall: settings.autoInstall ?? null
				});
				if (launchKey !== lastLaunchKey && current !== void 0) {
					current.dispose();
					current = void 0;
				}
				lastLaunchKey = launchKey;
				const service = resolveServiceConfig({
					command: settings.command || void 0,
					pythonPath: settings.pythonPath || void 0,
					uvCommand: settings.uvCommand || void 0,
					port: settings.port,
					baseUrl: settings.baseUrl || void 0,
					autoInstall: settings.autoInstall
				});
				const started = await startHeadroomService(ctx, service);
				if (id !== generation) {
					started.dispose();
					return;
				}
				if (started.reused) {
					ctx.reflect.set("headroomClient", started.client);
					return;
				}
				current?.dispose();
				ctx.reflect.set("headroomClient", started.client);
				current = { dispose: started.dispose };
			}).catch((error) => {
				ctx.logger.warn("dsh-headroom: proxy restart failed: %s", message(error));
			});
		};
		restart();
		const stopWatch = scope.watch(() => restart());
		return () => {
			generation += 1;
			stopWatch();
			current?.dispose();
			ctx.reflect.set("headroomClient", void 0);
		};
	}, "dsh-headroom: proxy lifecycle");
}
/**

* Register the headroom compaction engine as `ctx.compaction`. The Service

* constructor provides the name immediately, so a duplicate-registration

* conflict with the default compaction-basic backend surfaces synchronously;

* in that case the loader entry of compaction-basic is disabled at runtime

* and the headroom engine takes over. The takeover is rolled back when this

* plugin unloads (see {@link installTakeoverRollback}).

*/
function installEngine(ctx, config) {
	try {
		new HeadroomCompactionEngine(ctx, engineConfig(config));
		ctx.logger.info("dsh-headroom: compaction engine registered (backend=headroom)");
	} catch (error) {
		if (!serviceConflict(error)) {
			ctx.logger.warn("dsh-headroom: compaction engine registration failed: %s", message(error));
			return;
		}
		takeOverCompaction(ctx, config);
	}
}
/** Whether this plugin disabled compaction-basic loader entries at runtime. */
let compactionTakenOver = false;
/** Original disabled flags of the entries this plugin disabled, for rollback. */
let compactionRestore = [];
function loaderOf(ctx) {
	return ctx.loader;
}
/**

* Set every `compaction-basic` entry's disabled flag across the loader tree.

* Patch and preset layers can each carry an entry under the same id, and a

* bare `loader.update(id, ...)` only touches the first match in the current

* tree, so the takeover walks `entries()` instead. When the loader offers no

* `entries()` view, falls back to the tree-level update. Returns each touched

* entry's previous `disabled` value so the caller can restore them on unload.

* @param loader - the loader service surface.

* @param disabled - the disabled flag to write onto every match.

* @returns per-entry restore records (id plus the previous disabled value).

*/
async function setCompactionEntries(loader, disabled) {
	const targets = [...loader.entries?.() ?? []].filter((entry) => entry.id === "compaction-basic");
	if (targets.length === 0) {
		await loader.update("compaction-basic", { disabled });
		return [{
			id: "compaction-basic",
			disabled
		}];
	}
	const restore = targets.map((entry) => ({
		id: entry.id,
		disabled: entry.options.disabled
	}));
	for (const entry of targets) {
		await entry.update({ disabled }, false, true);
		entry.parent.tree.write();
	}
	return restore;
}
/**

* Restore the disabled flags recorded by {@link setCompactionEntries}, pairing

* restore records with the tree's current `compaction-basic` entries in order.

* Entries that no longer exist are skipped; a record with `disabled` unset

* removes the flag again (the entry re-inherits its composition default).

* @param loader - the loader service surface.

* @param restore - records previously returned by {@link setCompactionEntries}.

*/
async function restoreCompactionEntries(loader, restore) {
	const targets = [...loader.entries?.() ?? []].filter((entry) => entry.id === "compaction-basic");
	for (const [index, item] of restore.entries()) {
		const entry = targets[index];
		if (entry === void 0) continue;
		await entry.update({ disabled: item.disabled }, false, true);
		entry.parent.tree.write();
	}
}
async function takeOverCompaction(ctx, config) {
	const loader = loaderOf(ctx);
	if (loader === void 0) {
		ctx.logger.warn("dsh-headroom: no loader available to take over the compaction service; disable compaction-basic in cordis.patch.yml and restart dsh web");
		return;
	}
	try {
		compactionRestore = await setCompactionEntries(loader, true);
		new HeadroomCompactionEngine(ctx, engineConfig(config));
		compactionTakenOver = true;
		ctx.logger.info("dsh-headroom: disabled compaction-basic entries and registered the headroom engine");
	} catch (error) {
		ctx.logger.warn("dsh-headroom: could not take over the compaction service: %s", message(error));
	}
}
/**

* Restore the disabled compaction-basic entries when this plugin unloads, so

* the harness keeps a working compaction service after dsh-headroom is

* removed. The restore retries until the headroom engine's `compaction`

* service has been released by this fiber's disposal (disposers run in

* parallel, so the service may still be registered for a moment).

*/
function installTakeoverRollback(ctx) {
	ctx.effect(() => {
		let attempted = false;
		return async () => {
			if (!compactionTakenOver || attempted) return;
			attempted = true;
			const loader = loaderOf(ctx);
			if (loader === void 0) return;
			for (let attempt = 0; attempt < 30; attempt += 1) {
				await new Promise((resolve) => setTimeout(resolve, 50));
				try {
					await restoreCompactionEntries(loader, compactionRestore);
					ctx.logger.info("dsh-headroom: restored compaction-basic entries on unload");
					return;
				} catch {}
			}
			ctx.logger.warn("dsh-headroom: could not restore compaction-basic entries on unload; remove their `disabled: true` markers in the loader tree or restart dsh web");
		};
	}, "dsh-headroom: compaction takeover rollback");
}
function serviceConflict(error) {
	return error instanceof Error && error.message.includes("has been registered");
}
function message(error) {
	return error instanceof Error ? error.message : String(error);
}

//#endregion
export { Config, HEADROOM_SETTINGS_NS, apply, inject, name, restoreCompactionEntries, setCompactionEntries };