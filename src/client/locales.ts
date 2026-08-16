/** `dsh-headroom` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'cardTitle': 'Headroom 压缩',
  'cardDescription': '本地上下文压缩代理:超过阈值时用 Headroom 压缩历史,替代 LLM 总结。',
  'commandLabel': 'headroom 命令路径',
  'commandPlaceholder': '留空自动发现(如 ~/.local/bin/headroom)',
  'pythonPathLabel': 'Python 解释器路径',
  'pythonPathPlaceholder': '配置后以 python -m headroom 启动(可切换 Python 版本)',
  'uvCommandLabel': 'uv 命令路径',
  'uvCommandPlaceholder': '自动引导安装时使用;留空自动发现',
  'portLabel': '代理端口',
  'portPlaceholder': '8787',
  'baseUrlLabel': '代理地址',
  'baseUrlPlaceholder': '留空使用 http://127.0.0.1:<端口>',
  'autoInstallLabel': '缺少 headroom 时自动安装',
  'save': '保存',
  'discard': '放弃',
  'hint': '保存后立即重启本地代理(约 1 秒中断)。',
  'saving': '保存中…',
  'failed': '保存失败,请重试。',
  'invalidPort': '端口必须是 1–65535 的整数。',
} satisfies Record<string, string>

/** The dsh-headroom namespace key union. */
export type HeadroomKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'cardTitle': 'Headroom compression',
  'cardDescription': 'Local context-compression proxy: past the threshold, history is compressed by Headroom instead of LLM summarization.',
  'commandLabel': 'headroom command path',
  'commandPlaceholder': 'Empty = auto-discover (e.g. ~/.local/bin/headroom)',
  'pythonPathLabel': 'Python interpreter path',
  'pythonPathPlaceholder': 'When set, runs `python -m headroom` (pin a Python version)',
  'uvCommandLabel': 'uv command path',
  'uvCommandPlaceholder': 'Used by auto-install; empty = auto-discover',
  'portLabel': 'Proxy port',
  'portPlaceholder': '8787',
  'baseUrlLabel': 'Proxy base URL',
  'baseUrlPlaceholder': 'Empty = http://127.0.0.1:<port>',
  'autoInstallLabel': 'Auto-install headroom when missing',
  'save': 'Save',
  'discard': 'Discard',
  'hint': 'Saving restarts the local proxy immediately (~1s gap).',
  'saving': 'Saving…',
  'failed': 'Save failed, please retry.',
  'invalidPort': 'Port must be an integer between 1 and 65535.',
} satisfies Record<HeadroomKey, string>
