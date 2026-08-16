/**
 * 最小 `@deepseek-ai/dsh-client-runtime/client` mock:仅提供 controller
 * 测试需要的 snapshot-store 原语。vitest alias 把浏览器闭包 bundle
 * (window.__ModuleLoader__) 替换为这个可加载的模块。
 */

/** 可订阅的快照容器(与 runtime 的 createSnapshotStore 同语义的最小实现)。 */
export interface SnapshotStore<T> {
  getSnapshot(): T
  set(value: T): void
}

export function createSnapshotStore<T>(initial: T): SnapshotStore<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    set: (next) => {
      value = next
      for (const listener of listeners) listener()
    },
  }
}
