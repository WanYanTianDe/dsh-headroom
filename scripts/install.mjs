#!/usr/bin/env node
/**
 * 一键安装 dsh-headroom 到指定 profile:
 *   1. 在 profile 目录执行 pnpm add(建立依赖与 node_modules 链接)
 *   2. 向 profile 的 cordis.patch.yml 追加 insert 条目(幂等,已存在则跳过)
 *
 * 用法:node scripts/install.mjs [profile]   # 默认 web
 * 之后重启 dsh web 即可生效。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const PACKAGE_NAME = '@dsh-external/dsh-headroom'
const ENTRY_ID = 'dsh-headroom'
const PROFILE = process.argv[2] ?? 'web'
const pluginDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const profileDir = join(homedir(), '.dsh', 'profiles', PROFILE)

function fail(message) {
  console.error(`\n安装失败:${message}`)
  process.exit(1)
}

if (!existsSync(profileDir)) {
  fail(`profile "${PROFILE}" 不存在(${profileDir});先运行一次 dsh web 或 dsh --profile ${PROFILE} 初始化`)
}

// 1. pnpm add(在 profile 目录执行,使用本机 pnpm)
console.log(`1/2 正在把 ${PACKAGE_NAME} 加入 profile "${PROFILE}"…`)
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const add = spawnSync(pnpm, ['add', `link:${pluginDir}`], {
  cwd: profileDir,
  stdio: 'inherit',
  shell: false,
})
if (add.status !== 0) {
  fail(`pnpm add 执行失败(exit ${add.status});请确认已安装 pnpm`)
}

// 2. 追加 patch insert(幂等)
const patchFile = join(profileDir, 'cordis.patch.yml')
const patch = existsSync(patchFile) ? readFileSync(patchFile, 'utf8') : ''
if (patch.includes(`id: ${ENTRY_ID}`)) {
  console.log(`2/2 ${ENTRY_ID} 已在 ${patchFile} 中,跳过`)
} else {
  const insert = patch.trimEnd().endsWith(']')
    ? patch.trimEnd().slice(0, -1).trimEnd() + `\n    - id: ${ENTRY_ID}\n      name: '${PACKAGE_NAME}'\n]\n`
    : `${patch.trimEnd()}\n\n- insert:\n    - id: ${ENTRY_ID}\n      name: '${PACKAGE_NAME}'\n`
  writeFileSync(patchFile, insert)
  console.log(`2/2 已写入 ${patchFile}`)
}

console.log(`\n完成!重启 dsh web 后生效(打开 设置 → 插件,应能看到 "Headroom 压缩" 卡片)。`)
