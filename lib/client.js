window.__ModuleLoader__.load({ id: "dsh-headroom", factory: (require) => {
"use strict";
var module = { exports: {} }; var exports = module.exports;
//#region rolldown:runtime
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));

//#endregion
const react_jsx_runtime = __toESM(require("react/jsx-runtime"));
const __deepseek_ai_dsh_client_runtime_client = __toESM(require("@deepseek-ai/dsh-client-runtime/client"));

//#region \0dsh-css:src/client/HeadroomCard.module.css.mjs
const css = ".Zi8kzW_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;padding:14px 16px;list-style:none}.Zi8kzW_header{flex-direction:column;gap:4px;margin-bottom:12px;display:flex}.Zi8kzW_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}.Zi8kzW_description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}.Zi8kzW_field{flex-direction:column;gap:4px;margin-top:10px;display:flex}.Zi8kzW_label{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5}.Zi8kzW_input{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l3);box-sizing:border-box;border-radius:8px;width:100%;padding:6px 10px;font-size:13px;line-height:1.5}.Zi8kzW_input:focus{border-color:var(--dsw-alias-state-business-primary);outline:none}.Zi8kzW_input.Zi8kzW_invalid{border-color:var(--dsw-alias-state-error-primary)}.Zi8kzW_placeholder{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}.Zi8kzW_toggle{color:var(--dsw-alias-label-secondary);cursor:pointer;align-items:center;gap:8px;margin-top:10px;font-size:13px;line-height:1.5;display:flex}.Zi8kzW_actions{align-items:center;gap:8px;margin-top:12px;display:flex}.Zi8kzW_button{border:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}.Zi8kzW_button:disabled{opacity:.5;cursor:default}.Zi8kzW_buttonPrimary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:#0000}.Zi8kzW_status{font-size:12px;line-height:1.5}.Zi8kzW_statusError{color:var(--dsw-alias-state-error-primary)}.Zi8kzW_statusOk{color:var(--dsw-alias-state-success-primary)}.Zi8kzW_hint{color:var(--dsw-alias-label-tertiary);margin:10px 0 0;font-size:12px;line-height:1.5}";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"dsh-headroom/HeadroomCard.module.css\"]") === null) {
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-headroom";
	tag.dataset.pluginCss = "dsh-headroom/HeadroomCard.module.css";
	tag.textContent = css;
	document.head.appendChild(tag);
}
var HeadroomCard_module_css_default = {
	"card": "Zi8kzW_card",
	"description": "Zi8kzW_description",
	"label": "Zi8kzW_label",
	"input": "Zi8kzW_input",
	"header": "Zi8kzW_header",
	"hint": "Zi8kzW_hint",
	"statusError": "Zi8kzW_statusError",
	"toggle": "Zi8kzW_toggle",
	"invalid": "Zi8kzW_invalid",
	"buttonPrimary": "Zi8kzW_buttonPrimary",
	"field": "Zi8kzW_field",
	"placeholder": "Zi8kzW_placeholder",
	"actions": "Zi8kzW_actions",
	"name": "Zi8kzW_name",
	"button": "Zi8kzW_button",
	"statusOk": "Zi8kzW_statusOk",
	"status": "Zi8kzW_status"
};

//#endregion
//#region src/client/HeadroomCard.tsx
const TEXT_FIELDS = [
	{
		field: "command",
		label: "commandLabel",
		placeholder: "commandPlaceholder",
		numeric: false
	},
	{
		field: "pythonPath",
		label: "pythonPathLabel",
		placeholder: "pythonPathPlaceholder",
		numeric: false
	},
	{
		field: "uvCommand",
		label: "uvCommandLabel",
		placeholder: "uvCommandPlaceholder",
		numeric: false
	},
	{
		field: "port",
		label: "portLabel",
		placeholder: "portPlaceholder",
		numeric: true
	},
	{
		field: "baseUrl",
		label: "baseUrlLabel",
		placeholder: "baseUrlPlaceholder",
		numeric: false
	}
];
/**
* Render the Headroom settings card.
* @param props - locale copy, the card snapshot, and its form actions.
* @returns the card, or nothing while the namespace is unavailable.
*/
function HeadroomCard(props) {
	const { t } = props;
	const state = props.useHeadroomCard((snapshot) => snapshot);
	if (!state.available) return null;
	const fieldValue = (field) => {
		switch (field) {
			case "command": return state.command;
			case "pythonPath": return state.pythonPath;
			case "uvCommand": return state.uvCommand;
			case "port": return state.port;
			case "baseUrl": return state.baseUrl;
		}
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
		className: HeadroomCard_module_css_default.card,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: HeadroomCard_module_css_default.header,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: HeadroomCard_module_css_default.name,
					children: t("cardTitle")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: HeadroomCard_module_css_default.description,
					children: t("cardDescription")
				})]
			}),
			TEXT_FIELDS.map(({ field, label, placeholder, numeric }) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: HeadroomCard_module_css_default.field,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
						className: HeadroomCard_module_css_default.label,
						htmlFor: `dsh-headroom-${field}`,
						children: t(label)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						id: `dsh-headroom-${field}`,
						className: HeadroomCard_module_css_default.input + (numeric && state.invalid ? ` ${HeadroomCard_module_css_default.invalid}` : ""),
						type: "text",
						value: fieldValue(field),
						placeholder: t(placeholder),
						disabled: !state.writable,
						onChange: (event) => props.edit(field, event.target.value)
					}),
					numeric && state.invalid && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: HeadroomCard_module_css_default.placeholder,
						children: t("invalidPort")
					})
				]
			}, field)),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: HeadroomCard_module_css_default.toggle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					type: "checkbox",
					checked: state.autoInstall,
					disabled: !state.writable,
					onChange: props.toggleAutoInstall
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("autoInstallLabel") })]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: HeadroomCard_module_css_default.actions,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: `${HeadroomCard_module_css_default.button} ${HeadroomCard_module_css_default.buttonPrimary}`,
						disabled: !state.dirty || state.invalid || state.saving,
						onClick: props.save,
						children: state.saving ? t("saving") : t("save")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: HeadroomCard_module_css_default.button,
						disabled: !state.dirty && !state.failed || state.saving,
						onClick: props.discard,
						children: t("discard")
					}),
					state.failed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: `${HeadroomCard_module_css_default.status} ${HeadroomCard_module_css_default.statusError}`,
						children: t("failed")
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: HeadroomCard_module_css_default.hint,
				children: t("hint")
			})
		]
	});
}

//#endregion
//#region src/client/headroom-card-controller.ts
function textValue(value) {
	return typeof value === "string" ? value : "";
}
function portText(value) {
	return typeof value === "number" ? String(value) : "";
}
var HeadroomCardController = class {
	staged = new Map();
	saving = false;
	failed = false;
	store;
	constructor(scope) {
		this.scope = scope;
		this.store = (0, __deepseek_ai_dsh_client_runtime_client.createSnapshotStore)(this.projection());
		scope.subscribe(() => {
			this.publish();
		});
	}
	projection() {
		const snapshot = this.scope.getSnapshot();
		const value = snapshot.value;
		return {
			available: snapshot.status === "ready",
			writable: snapshot.writable,
			dirty: this.staged.size > 0,
			invalid: this.stagedPortInvalid(),
			saving: this.saving,
			failed: this.failed,
			command: this.draft("command", textValue(value?.command)),
			pythonPath: this.draft("pythonPath", textValue(value?.pythonPath)),
			uvCommand: this.draft("uvCommand", textValue(value?.uvCommand)),
			port: this.draft("port", portText(value?.port)),
			baseUrl: this.draft("baseUrl", textValue(value?.baseUrl)),
			autoInstall: value?.autoInstall ?? true
		};
	}
	draft(field, stored) {
		return this.staged.get(field) ?? stored;
	}
	stagedPortInvalid() {
		const port = this.staged.get("port");
		if (port === void 0) return false;
		const trimmed = port.trim();
		if (trimmed === "") return false;
		const parsed = Number(trimmed);
		return !Number.isInteger(parsed) || parsed < 1 || parsed > 65535;
	}
	publish() {
		this.store.set(this.projection());
	}
	stage(field, text) {
		this.staged.set(field, text);
		this.failed = false;
		this.publish();
	}
	async commit() {
		const writes = [];
		for (const [field, text] of this.staged) {
			const trimmed = text.trim();
			if (field === "port") if (trimmed === "") writes.push(this.scope.unset("port"));
			else writes.push(this.scope.set("port", Number(trimmed)));
			else if (trimmed === "") writes.push(this.scope.unset(field));
			else writes.push(this.scope.set(field, trimmed));
		}
		await Promise.all(writes);
	}
	/**
	* Write every staged edit, then re-seed from the Host's accepted state.
	* A failed save keeps its drafts so the user can correct them.
	*/
	async save() {
		if (this.staged.size === 0 || this.saving || this.stagedPortInvalid()) return;
		this.saving = true;
		this.failed = false;
		this.publish();
		try {
			await this.commit();
			this.staged.clear();
		} catch {
			this.failed = true;
		} finally {
			this.saving = false;
			this.publish();
		}
	}
	/** Build the face the card's slot registration injects. */
	inject() {
		return {
			hooks: { headroomCard: this.store },
			edit: (field, text) => this.stage(field, text),
			toggleAutoInstall: () => {
				this.failed = false;
				this.scope.set("autoInstall", !(this.scope.getSnapshot().value?.autoInstall ?? true));
			},
			save: () => {
				this.save();
			},
			discard: () => {
				if (this.staged.size === 0 && !this.failed) return;
				this.staged.clear();
				this.failed = false;
				this.publish();
			}
		};
	}
};

//#endregion
//#region src/client/locales.ts
/** `dsh-headroom` namespace dictionaries. */
/** Simplified Chinese dictionary (the key-set source of truth). */
const zh = {
	"cardTitle": "Headroom 压缩",
	"cardDescription": "本地上下文压缩代理:超过阈值时用 Headroom 压缩历史,替代 LLM 总结。",
	"commandLabel": "headroom 命令路径",
	"commandPlaceholder": "留空自动发现(如 ~/.local/bin/headroom)",
	"pythonPathLabel": "Python 解释器路径",
	"pythonPathPlaceholder": "配置后以 python -m headroom 启动(可切换 Python 版本)",
	"uvCommandLabel": "uv 命令路径",
	"uvCommandPlaceholder": "自动引导安装时使用;留空自动发现",
	"portLabel": "代理端口",
	"portPlaceholder": "8787",
	"baseUrlLabel": "代理地址",
	"baseUrlPlaceholder": "留空使用 http://127.0.0.1:<端口>",
	"autoInstallLabel": "缺少 headroom 时自动安装",
	"save": "保存",
	"discard": "放弃",
	"hint": "保存后立即重启本地代理(约 1 秒中断)。",
	"saving": "保存中…",
	"failed": "保存失败,请重试。",
	"invalidPort": "端口必须是 1–65535 的整数。"
};
/** English dictionary, checked complete against the zh key set. */
const en = {
	"cardTitle": "Headroom compression",
	"cardDescription": "Local context-compression proxy: past the threshold, history is compressed by Headroom instead of LLM summarization.",
	"commandLabel": "headroom command path",
	"commandPlaceholder": "Empty = auto-discover (e.g. ~/.local/bin/headroom)",
	"pythonPathLabel": "Python interpreter path",
	"pythonPathPlaceholder": "When set, runs `python -m headroom` (pin a Python version)",
	"uvCommandLabel": "uv command path",
	"uvCommandPlaceholder": "Used by auto-install; empty = auto-discover",
	"portLabel": "Proxy port",
	"portPlaceholder": "8787",
	"baseUrlLabel": "Proxy base URL",
	"baseUrlPlaceholder": "Empty = http://127.0.0.1:<port>",
	"autoInstallLabel": "Auto-install headroom when missing",
	"save": "Save",
	"discard": "Discard",
	"hint": "Saving restarts the local proxy immediately (~1s gap).",
	"saving": "Saving…",
	"failed": "Save failed, please retry.",
	"invalidPort": "Port must be an integer between 1 and 65535."
};

//#endregion
//#region src/client/index.ts
/** Dictionary namespace owned by this plugin. */
const NS = "dsh-headroom";
/** Required services (cordis fiber inject). */
const inject = [
	"slots",
	"locale",
	"settingsScope"
];
/**
* Mount the Headroom settings card.
* @param ctx - the browser plugin context.
*/
function apply(ctx) {
	ctx.effect(() => ctx.locale.register(NS, {
		zh,
		en
	}), "dsh-headroom: dictionaries");
	const controller = new HeadroomCardController(ctx.settingsScope.bind({ namespace: "headroom" }));
	ctx.slots.inject("settings.plugin.item", function* () {
		yield ctx.slots.register({
			name: "settings.plugin.item",
			id: "dsh-headroom",
			order: 60,
			locale: NS,
			inject: () => controller.inject()
		}, HeadroomCard);
	});
}

//#endregion
exports.apply = apply
exports.inject = inject
return module.exports; } });