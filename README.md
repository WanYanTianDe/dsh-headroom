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
- 大工具输出(默认超过 16384 字符)也会被自动压缩
- 压缩不等于删除——原文都存着,模型需要细节时会自己取回

## 功能

| 组件 | 说明 |
|---|---|
| 代理生命周期 | 启动时探测 `127.0.0.1:8787`;无服务则自动发现 `headroom` 命令,缺失时经 `uv tool install headroom-ai[all]` 引导安装;然后 spawn `headroom proxy`,等待健康后挂载 `ctx.headroomClient`。设置变更时串行重启(复用不杀旧代理;启动配置变更强制换代理)。插件卸载时清理进程树。 |
| 历史压缩 | 对话 token 压力/溢出时,把选中的历史区间发给本地代理 `POST /v1/compress`,压缩结果文本化为 checkpoint 写入会话。继承 harness 压缩后端全部机制(region 事务/压力触发/溢出恢复/持久化)。 |
| 工具输出压缩 | 每次模型请求前(step 边界),把超过阈值的大工具输出经代理压缩并影子替换为压缩文本;原文留在会话日志(可重建),模型可经 `headroom_retrieve` 取回完整内容。无收益(<20% token 节省)或代理不可用时保留原文。 |
| 取回工具 | `headroom_retrieve(hash)` → `POST /v1/retrieve`,模型按压缩文本/checkpoint 中的 ccr hash 取回被压缩的原文(历史与工具输出通用)。 |
| 设置卡片 | 浏览器 **设置 → 插件 → Headroom 压缩**,编辑代理路径/端口与压缩策略;保存后即时生效。 |

## 配置

### 设置面板(推荐)

| 想做的事 | 怎么弄 |
|---|---|
| 换一个 Python 来跑服务 | 填 "Python 解释器路径",保存,立刻生效 |
| 指定压缩服务的位置 | 填 "headroom 命令路径"(一般不用管,自动找) |
| 换端口 | 改 "代理端口" |
| 不让它自动装服务 | 关掉 "缺少 headroom 时自动安装" |
| 关掉工具输出压缩 | 关掉 "压缩大工具输出"(默认开) |
| 调工具输出压缩阈值 | 改 "工具输出压缩阈值(字符)"(默认 8192) |

### cordis config(设置面板未覆盖的高级项)

```yaml
# 插件 entry 的 config 下:
config:
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
- 后端为本地 Python 服务(uv 工具),首次自动安装约数百 MB。
- **实测压缩收益(按内容类型,headroom 0.35 默认配置)**:中文/英文散文约 50-80%,代码约 27%,复杂 JSON 约 17%,重复 JSON 与日志接近 0%(收益不足门槛时插件保留原文,不会变差)。
- 工具输出压缩默认阈值 8192 字符、最低收益 15%;低于阈值不压缩,收益不足不替换。
- **更激进的压缩**:以环境变量 `HEADROOM_TARGET_RATIO=0.3`(或更小)启动 dsh web 即可让代理的文本压缩更激进(散文收益可到 80%+,代价是信息保留更少)。
- **已知限制:CCR 原文取回目前不可用**——代理的 lossy 压缩器(Kompress,ModernBERT 模型)在 OSS 默认安装下未初始化,`/v1/compress` 走 lossless 路径不产生 CCR 记录,`headroom_retrieve` 暂无可取回的原文。压缩本身不受影响(压缩即替换,模型看到的是压缩版)。
- 工具输出压缩阈值默认 16384 字符;低于阈值的输出不压缩,压缩收益不足 20% 不替换。
- 与 harness 的 `compaction-basic` 冲突时自动接管(见 FAQ)。

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
