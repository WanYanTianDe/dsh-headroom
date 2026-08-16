/**
 * tsdown preset for dsh-headroom: a node-half bundle plus a browser-half
 * client bundle (closure factory for window.__ModuleLoader__, CSS Modules via
 * lightningcss). @deepseek-ai/* host imports stay external; the client bundle
 * only keeps platform modules external.
 */

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

/** Module specifiers the dsh web shell shares into its frozen module table. */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', 'cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-schema-form',
] as const

const CLIENT_EXTERNALS: readonly string[] = [...PLATFORM_MODULES, '@deepseek-ai/dsh-client-runtime/client']

function isExternal(source: string): boolean {
  return CLIENT_EXTERNALS.includes(source)
}

const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'
const require = createRequire(import.meta.url)

const PLUGIN_ID = 'dsh-headroom'

function resolveCssFile(source: string, importer: string | undefined): string {
  if (source.startsWith('.')) {
    if (importer === undefined) throw new Error(`cannot resolve relative css "${source}" without an importer`)
    return resolvePath(dirname(importer), source)
  }
  return require.resolve(source)
}

function styleTagModule(fileId: string, css: string, tagId: string): string {
  return [
    `const css = ${JSON.stringify(css)};`,
    `if (typeof document !== 'undefined' && document.querySelector(${JSON.stringify(`style[data-plugin-css="${tagId}"]`)}) === null) {`,
    `  const tag = document.createElement('style');`,
    `  tag.dataset.plugin = ${JSON.stringify(PLUGIN_ID)};`,
    `  tag.dataset.pluginCss = ${JSON.stringify(tagId)};`,
    `  tag.textContent = css;`,
    `  document.head.appendChild(tag);`,
    `}`,
  ].join('\n')
}

export default [
  {
    // Node half: the host loader imports lib/index.js.
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: true,
    external: [/^@deepseek-ai\//, /^node:/],
  },
  {
    // Browser bundle: lib/client.js, served by the harness at /plugins/<id>/client.js.
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    clean: false,
    external: [...CLIENT_EXTERNALS],
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    noExternal: (id: string) => { return isExternal(id) ? undefined : true },
    plugins: [{
      name: 'dsh-client-bundle-purity',
      resolveId(source: string) {
        if (!source.startsWith('@deepseek-ai/')) return null
        if (isExternal(source)) return null
        throw new Error(
          `client bundle purity: "${source}" is not a platform module (loader module table) — `
          + 'cross-plugin value imports are forbidden; collaborate through cordis services',
        )
      },
    }, {
      name: 'dsh-css-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.css')) return null
        const abs = resolveCssFile(source, importer)
        return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
        const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
        this.addWatchFile(fileId)
        const source = await readFile(fileId)
        const tagId = `${PLUGIN_ID}/${basename(fileId)}`
        if (fileId.endsWith('.module.css')) {
          const { code, exports: cssExports } = transform({
            filename: fileId,
            code: source,
            cssModules: { pattern: `[hash]_[local]` },
            minify: true,
          })
          const classMap: Record<string, string> = {}
          for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
          return styleTagModule(fileId, code.toString(), tagId)
            + `\nexport default ${JSON.stringify(classMap)};`
        }
        return styleTagModule(fileId, source.toString(), tagId) + `\nexport default css;`
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
] satisfies UserConfig[]
