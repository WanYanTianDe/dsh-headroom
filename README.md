# dsh-headroom

给 DeepSeek Harness 装的"省钱引擎":对话太长时自动把旧内容压紧、大工具输出自动瘦身,少烧 token;需要细节时,模型还能自动找回原文。

> 非官方社区插件,与 Headroom Labs / DeepSeek 无隶属关系。

## 装它

### 方式一:npm 安装(推荐,已发布到 npm registry)

```bash
# 在 profile 目录(~/.dsh/profiles/web)执行,把包装进 profile:
pnpm add @wanyantiande/dsh-headroom

# 然后编辑 cordis.patch.yml,加:
#   - insert:
#       - id: dsh-headroom
#         name: '@wanyantiande/dsh-headroom'
```

**重启 dsh web** 即可用,打开 **设置 → 插件** 能看到 **"Headroom 压缩"** 卡片。

### 方式二:从源码装(开发/本地修改用)

```bash
# 1. 拿到代码
git clone https://github.com/WanYanTianDe/dsh-headroom.git
cd dsh-headroom

# 2. 一键安装(默认装进 web profile)
node scripts/install.mjs
```

脚本会自动把插件装进 profile 并配好,然后**重启 dsh web** 就能用。

> 手动装也可以,就两步:
> ```bash
> dsh plugin --profile web add link:这个插件的路径
> # 然后编辑 ~/.dsh/profiles/web/cordis.patch.yml,加:
> #   - insert:
> #       - id: dsh-headroom
> #         name: '@wanyantiande/dsh-headroom'
> ```

## 用起来(什么都不用做)

- 插件会自动准备好本地压缩服务(第一次会自动下载,稍等一会儿)
- 对话变长后,旧内容会被自动压缩,省 token
- 大工具输出(默认超过 8192 字符)也会被自动压缩
- 压缩不等于删除——原文都存着,模型需要细节时会自己取回

## 功能

| 组件 | 说明 |
|---|---|
| 代理生命周期 | 启动时探测 `127.0.0.1:8787`;无服务则自动发现 `headroom` 命令,缺失时经 `uv tool install headroom-ai[all]` 引导安装;然后 spawn `headroom proxy`,等待健康后挂载 `ctx.headroomClient`。设置变更时串行重启(复用不杀旧代理;启动配置变更强制换代理)。插件卸载时清理进程树。 |
| 历史压缩 | 对话 token 压力/溢出时,把选中的历史区间发给本地代理 `POST /v1/compress`,压缩结果文本化为 checkpoint 写入会话。继承 harness 压缩后端全部机制(region 事务/压力触发/溢出恢复/持久化)。 |
| 工具输出压缩 | 每次模型请求前(step 边界),把超过阈值的大工具输出经代理压缩并影子替换为压缩文本;原文留在会话日志(可重建),模型可经 `headroom_retrieve` 取回完整内容。无收益(<20% token 节省)或代理不可用时保留原文。 |
| 取回工具 | `headroom_retrieve(hash)` → `POST /v1/retrieve`,模型按压缩文本/checkpoint 中的 ccr hash 取回被压缩的原文(历史与工具输出通用)。 |
| 配置命令 | `/headroom` 对话命令:查看/修改代理与压缩设置(写同一 settings 命名空间,不依赖设置面板);设置卡片因 harness 白名单限制可能不可见(见"配置"章节)。 |

## 配置

### 方式一:对话命令 `/headroom`(所有环境可用)

在任意会话输入(agent 也会执行):

```
/headroom                          # 查看当前生效配置
/headroom set port 9000            # 修改配置(数字/布尔/字符串按类型解析)
/headroom unset port               # 恢复组合层默认
```

可设置键:`port`、`baseUrl`、`command`、`pythonPath`、`uvCommand`、`autoInstall`、`resultCompressionEnabled`、`resultCompressionThresholdChars`。

### 方式二:设置卡片(需要 harness 白名单支持)

**设置 → 插件 → 插件配置** 里的 "Headroom 压缩" 卡片依赖 harness 的配置客户端暴露白名单(`api-proxy.ts` 的 `WEB_SETTINGS_NAMESPACES`,官方注释承认是待办)。**外部插件默认不在白名单中**,卡片会不可见——这是 harness 的限制,不是插件缺陷。两种解决:
- 在 harness 的 `WEB_SETTINGS_NAMESPACES` 加 `'headroom'`(一行)后重启;
- 或直接用 `/headroom` 命令(方式一,无此限制)。

### 方式三:settings.yaml / cordis config

```yaml
# ~/.dsh/settings.yaml 的 headroom 段
headroom:
  port: 8787
  command: ''        # 留空自动发现
  autoInstall: true
```

```yaml
# 插件 entry 的 config 下(设置面板未覆盖的高级项):
config:
  compressMode: 'ccr'         # 压缩请求模式:'ccr' 写入 CCR 取回 hash(默认,headroom_retrieve 可用);'default' 关闭
  prewarm: true               # 启动时预热 Kompress 模型(默认 true,避免首个请求被跳过)
  headroom:
    savingsProfile: 'coding'  # 代理压缩画像:'agent-90' = 全部内容强制 Kompress 压缩(激进有损)
    kompressMustKeep: true    # 保留数字/路径/标识符;false 时 JSON 收益可达 96%,但精确值会被丢弃(须配合 CCR)
  resultCompression:
    minSavingsRatio: 0.15   # 工具输出压缩的最小收益比例(默认 0.15)
    maxPerStep: 3           # 单次 step 最多压缩条数(默认 3)
  thresholdRatio: 0.8       # 历史压缩压力阈值(默认 0.8,继承 BasicCompactionConfig)
  retainRatio: 0.16         # 历史保留比例(默认 0.16)
  auto: true                # 自动压缩开关(默认 true)
```

## 行为与限制

- 压缩发生在 step 边界;替换遵循 harness 影子节点协议,消息保持可重建(会话日志是唯一事实源)。
- checkpoint 必须比原文小,否则事务失败并保留原文(继承的安全语义)。
- 无 headroom 服务时插件保持加载、压缩自动禁用,DSH 其余功能不受影响。
- 后端为本地 Python 服务(uv 工具),首次自动安装约数百 MB;Kompress 模型(`chopratejas/kompress-v2-base`,261MB ONNX)首次压缩时自动下载,插件启动预热,之后压缩走 ML 有损路径(散文 33.5%,激进配置 JSON 96%)。
- 工具输出压缩默认阈值 8192 字符、最低收益 15%;低于阈值不压缩,收益不足不替换(负收益内容永远不会比不装更差)。
- **CCR 原文取回可用**(0.3.0 起):压缩请求默认 `mode: 'ccr'`,有损替换写入 CCR store,`headroom_retrieve` 按 hash 恢复原文。
- `kompressMustKeep: false` 是有损激进模式(数字/ID/路径可能被丢弃),务必保持 CCR 模式以便取回。
- 与 harness 的 `compaction-basic` 冲突时自动接管(见 FAQ)。
- 完整实测数据见下方「性能实测」章节。

## 性能实测

> 环境:headroom 0.35.0(OSS,Kompress ONNX 模型已加载)+ DeepSeek Harness web 会话。合成测量对真实代理 `POST /v1/compress`;端到端为真实会话日志统计。

### 按内容类型的压缩收益(上限/下限)

**lossless 路径**(0.2.x,模型未启用时):

| 内容类型 | 压缩收益 | 角色 |
|---|---|---|
| 中文散文 | **52.6%** | 上限(upper bound) |
| 英文/混合散文 | 24.3% ~ 33% | 上限 |
| 代码(AST 感知) | 27.5% | 高 |
| 复杂 JSON | 17.8% ~ 30.4% | 中 |
| 日志 / 简单文本 | ~0% | 下限(lower bound) |
| 重复 JSON | -15%(变差) | 下限:被 15% 门槛拦截,保留原文 |

**Kompress(ML 有损)路径**(0.3.0 起,模型自动下载+预热):

| 场景 | 压缩收益 | 说明 |
|---|---|---|
| 中文散文(默认 profile) | **33.5%** | `router:text` (Kompress) |
| JSON(agent-90 + `kompressMustKeep: false`) | **96.6%** | `router:kompress:0.03`;精确值被丢弃,须 CCR 取回 |
| JSON(agent-90,默认 must-keep) | ~9% | must-keep 规则保留数字/路径,紧凑 JSON 几乎全命中 |
| CCR 恢复 | 完整 | `/v1/retrieve` 按 hash 取回 56,803 字符原文(实测) |

### 端到端实测(真实会话)

- 5 次影子替换落地(每次含 `compaction/prune` 定价事件 + `tool/result` 替换,会话日志可重建)。
- 实际压缩收益 24.3% / 30.4% / 33%(text/mixed 压缩器)。
- 0% 收益候选被正确跳过(不替换、不劣化)。
- headless 一次性模式:修复后 `compaction/start/end` 事件与代理压缩请求均出现(0.3.0)。

### 历史压缩(长会话)

- 早前实测:2410 → 1619 tokens(**33%** 收益),触发于上下文压力/溢出。

### 结论:节省区间

**默认配置下,装比不装节省 0% ~ 53%**(工具输出压缩 + 历史压缩叠加);开启 Kompress 激进模式(`agent-90` + `kompressMustKeep: false`)后 JSON 类内容可达 **96%**,整体上限大幅上移:

| 负载画像 | lossless(默认) | Kompress 激进 |
|---|---|---|
| 散文密集(文档阅读/总结) | 25% ~ 53% | 30% ~ 60%+ |
| 开发混合(代码/JSON) | 18% ~ 33% | JSON 类 60% ~ 96% |
| 日志/重复数据(构建输出) | ~0%(无损失) | 视 must-keep 配置 |

插件保证**下限恒为 0%**——负收益内容被收益门槛拦截,低于阈值的内容不触发。

## 常见问题

**Q: 装不上 / 服务起不来?**
先手动把服务装好再重启试试:
```bash
uv tool install "headroom-ai[all]"
```
或者看设置卡片上的提示。

**Q: 压缩会把内容弄丢吗?**
不会。原文都存在本地,模型需要时会自动取回(工具 `headroom_retrieve`)。

**Q: 想用自己电脑上的 Python 跑?**
设置卡片填 Python 路径保存即可,马上换。

**Q: 和 dsh-compressor 有什么区别?**
它只压缩工具的输出,我们**历史压缩和工具输出压缩都做**(0.2.0 起内置工具输出压缩),取回统一走 `headroom_retrieve`。装了本插件就不需要 dsh-compressor 了;两者并存也无冲突。

**Q: 装了它,原来的 compaction-basic 会怎样?**
会自动被本插件接管:启动时若发现压缩服务已被 compaction-basic 占用,插件会禁用 compaction-basic 的装配条目(写入你的 `cordis.patch.yml`,preset 文件不会被改写)并注册 headroom 压缩引擎;卸载插件时自动恢复原状态。如果不想让 headroom 接管压缩,请勿同时启用两者。

## 给开发者

```bash
bash scripts/build.sh      # 构建:类型检查 + 测试 + 打包(需要 DSH 源码,见下)
pnpm test                  # 测试(37 例,不需要 DSH 源码)
pnpm typecheck             # 类型检查
pnpm build                 # 打包 → lib/index.js + lib/client.js
```

构建需要 DSH 源码:设环境变量 `DSH_CHECKOUT` 指向 DSH 源码目录,或建链接 `~/.dsh/source/current` → DSH 源码目录。插件目录放在 `~/.dsh/plugins/` 下(开发依赖用相对路径引用 DSH 检出)。

## 收录信息

| 项 | 值 |
|---|---|
| npm 包名 | `@wanyantiande/dsh-headroom`(npm registry, public) |
| GitHub topic | `dsh-plugin` |
| 分类(taxonomy v2) | 🤖 Agent 能力 |
| 测试 | vitest 37 例(format/service/takeover/result-compressor/controller) |
| 许可 | MIT(插件);依赖的 Headroom 为 Apache-2.0,DSH 为 MIT |

## 许可

- 插件本体:MIT(见 [LICENSE](LICENSE))
- 依赖的 [Headroom](https://github.com/headroomlabs-ai/headroom):Apache-2.0
- 依赖的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness):MIT

插件不捆绑 headroom 的代码,通过 uv 安装其发行版并调用本地服务。
