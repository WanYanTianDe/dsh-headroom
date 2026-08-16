# dsh-headroom

将 [Headroom](https://github.com/headroomlabs-ai/headroom)(AI agent 上下文压缩层)接入 DeepSeek Harness 的插件:本地代理生命周期管理 + Headroom 压缩后端(替代 LLM 总结的 compaction engine)+ `headroom_retrieve` CCR 取回工具 + 设置卡片。

> 非官方社区插件,与 Headroom Labs / DeepSeek 无隶属关系。

## 收录信息

| 项 | 值 |
|---|---|
| npm 包名 | `@dsh-external/dsh-headroom` |
| GitHub topic | `dsh-plugin` |
| 分类(taxonomy v2) | 🤖 Agent 能力 |
| 运行时依赖 | 已声明(peerDependencies);运行需要本地 headroom(Python)服务,插件自动引导安装 |

## 组件

| 组件 | 说明 |
|---|---|
| 代理生命周期 | 启动时探测 `127.0.0.1:8787`;无服务则自动发现 `headroom` 命令,缺失时经 `uv tool install headroom-ai[all]` 引导安装;然后 spawn `headroom proxy`,等待健康后挂载 `ctx.headroomClient`。设置变更时串行重启(复用不杀旧代理;启动配置变更强制换代理)。插件卸载时清理进程树。 |
| 压缩后端 | `HeadroomCompactionEngine extends BasicCompactionEngine`,只覆写 `summarize()`:把选中的历史区间发给本地代理 `POST /v1/compress`,压缩后的消息序列文本化为 checkpoint 写入会话(继承全部 region 事务/压力触发/溢出恢复/持久化机制)。 |
| 取回工具 | `headroom_retrieve(hash)` → `POST /v1/retrieve`,模型可按 checkpoint 中的 ccr hash 取回被压缩的原文。 |
| 设置卡片 | 浏览器 设置 → 插件配置页出现 "Headroom 压缩" 卡片,可编辑 headroom/uv/python 路径、端口、代理地址、自动安装开关;保存后即时生效(代理重启)。 |

## 安装

### 前置

1. DeepSeek Harness 运行中(`dsh web`)。
2. **构建用 DSH 源码**:`~/.dsh/source/current` 是指向含 `lib/` 产物的 DSH 检出目录的 junction/symlink(开发依赖经它解析,见下文"位置约束")。
3. **运行用 headroom(Python)**:无需手动安装——插件首次启动自动经 `uv tool install headroom-ai[all]` 引导(也可在设置卡片里配 `pythonPath` 指向已装 headroom-ai 的解释器)。

### 获取与装配

```powershell
# 1. 建 DSH 源码 junction(构建依赖解析用;Linux/macOS 用 ln -s 代替)
New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\source\current" -Target "F:\path\to\deepseek-harness"

# 2. 克隆到 ~/.dsh/plugins/ 下(必须,相对 link 路径按此解析,见"位置约束")
git clone https://github.com/WanYanTianDe/dsh-headroom.git "$env:USERPROFILE\.dsh\plugins\dsh-headroom"

# 3. 构建(先类型检查再打包;构建产物 lib/ 已入库,跳过构建也可直接装配)
cd "$env:USERPROFILE\.dsh\plugins\dsh-headroom"
pnpm install
pnpm build

# 4. 装配(本插件是普通 cordis 插件,只能走 cordis.patch.yml 的 insert)
#    在 ~/.dsh/profiles/<profile>/cordis.patch.yml 添加:
#     - insert:
#         - id: dsh-headroom
#           name: '@dsh-external/dsh-headroom'
```

**位置约束**:`package.json` 的 devDependencies 用相对路径 `link:../../source/current/...` 指向 DSH 检出,该路径从插件包目录解析,因此**插件必须位于 `~/.dsh/plugins/<name>`**。放到其他位置时,请把 package.json 里的 `../../source/current` 改为指向你 DSH 检出的相对或绝对路径。

`profile package.json` 里需有 `"@dsh-external/dsh-headroom": "link:<插件绝对路径>"` 依赖与 `node_modules` junction(用 `dev_install_package` 或手动 `pnpm add link:...` 建立),patch 的 `insert` 才能解析包名。

## 配置

设置面板(浏览器)或 `settings.yaml`:

```yaml
headroom:
  port: 8787                  # 代理端口(默认)
  command: ''                 # headroom 可执行文件路径;留空自动发现(~/.local/bin)
  pythonPath: ''              # Python 解释器路径;配置后以 `python -m headroom.cli` 启动代理(可切换 Python 版本)
  uvCommand: ''               # uv 路径;自动引导安装时使用
  baseUrl: ''                 # 代理地址;留空使用 http://127.0.0.1:<端口>
  autoInstall: true           # 缺命令时自动安装(pythonPath 用 pip,否则用 uv tool install)
```

启动优先级:`pythonPath` > `command` > 自动发现;修改任一启动配置(路径/端口/地址)会立即重启代理。

压缩策略继承 `BasicCompactionConfig`(可通过 cordis config 配 `thresholdRatio` / `retainRatio` / `auto` 等)。

## 行为与限制

- 压缩发生在 step 边界,替换为影子 checkpoint 节点,消息保持可重建(会话日志是唯一事实源)。
- checkpoint 必须比原文小,否则事务失败并保留原文(继承的安全语义)。
- 无 headroom 服务时插件保持加载、压缩自动禁用,DSH 其余功能不受影响。
- 后端为本地 Python 服务(uv 工具),首次自动安装约数百 MB;压缩幅度由 headroom 策略决定(JSON 密集内容收益最高;默认策略保守以保 KV 缓存)。
- 已在本机验证:代理 spawn/复用/重启(配置变更)、`/v1/compress` 端到端压缩、引擎 summarize 链路(2410→1619 tokens)、工具注册、client bundle 服务、`pythonPath` 切换。

## 与 dsh-compressor 的关系

社区已有 [dsh-compressor](https://github.com/lifeodyssey/dsh-compressor)(Headroom 的 Rust 精简移植,压缩工具输出)。两者定位互补:

| 维度 | dsh-headroom | dsh-compressor |
|---|---|---|
| 压缩对象 | 会话历史区间(CompactionEngine) | 工具输出(tool-result) |
| 触发 | token 压力/溢出(step 边界) | 工具运行后即时 |
| 实现 | 调用 headroom Python 服务(完整管道) | Rust native(Log/Smart/Text 等) |
| Windows | 开箱即用(实测) | 无 win32 prebuilt,需自编译 native |
| 原文取回 | `headroom_retrieve`(CCR) | `compressor_retrieve`(磁盘 hash) |

实测(同机,统一 tiktoken 计数):compressor 对高重复日志压缩极强(99%),对中等重复 JSON 几乎不压(0.1%);headroom 保守保义(JSON 5%、日志不压、压缩整段会话)。两者可并存(compressor 管 tool 输出即时瘦身,本插件管历史区间压力压缩)。

## 开发

```sh
pnpm install        # devDependencies 以 link:../../source/current 指向 DSH 检出(插件须位于 ~/.dsh/plugins/<name>)
pnpm build          # 先 tsc 类型检查,再 tsdown 打包 → lib/index.js + lib/client.js
pnpm typecheck      # 单独跑类型检查
```

## 许可

- 插件本体:MIT(见 [LICENSE](LICENSE))
- 依赖的 [Headroom](https://github.com/headroomlabs-ai/headroom):Apache-2.0
- 依赖的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness):MIT

插件不捆绑 headroom 源码/二进制,通过 uv 安装其 Python 发行版并调用本地服务。
