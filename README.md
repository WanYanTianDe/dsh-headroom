# dsh-headroom

给 DeepSeek Harness 装的"省钱引擎":对话太长时,自动把旧内容压紧,少烧 token;需要细节时,还能自动找回原文。

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

## 想改点什么?去设置里点

**设置 → 插件 → Headroom 压缩**:

| 想做的事 | 怎么弄 |
|---|---|
| 换一个 Python 来跑服务 | 填 "Python 解释器路径",保存,立刻生效 |
| 指定压缩服务的位置 | 填 "headroom 命令路径"(一般不用管,自动找) |
| 换端口 | 改 "代理端口" |
| 不让它自动装服务 | 关掉 "缺少 headroom 时自动安装" |
| 关掉工具输出压缩 | 关掉 "压缩大工具输出"(默认开) |
| 调工具输出压缩阈值 | 改 "工具输出压缩阈值(字符)"(默认 16384) |

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
它只压缩工具的输出,我们**历史压缩和工具输出压缩都做**(0.2.0 起内置工具输出压缩),压缩对象和取回方式更统一。装了本插件就不需要 dsh-compressor 了;两者并存也无冲突。

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
