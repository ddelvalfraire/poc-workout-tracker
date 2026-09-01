/**
 * An in-memory Web Storage for tests. The vitest jsdom environment exposes
 * no working `window.localStorage` here (Node's own experimental
 * `localStorage` global shadows jsdom's, and reads as undefined without
 * `--localstorage-file`), so code that persists through `window.localStorage`
 * gets this stand-in installed per test instead. Same contract as the real
 * thing: `key(i)`/`length` iteration, string values, null on miss.
 */
export class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>()

  get length(): number {
    return this.map.size
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value))
  }

  removeItem(key: string): void {
    this.map.delete(key)
  }

  clear(): void {
    this.map.clear()
  }
}

/** Installs a fresh MemoryStorage as `window.localStorage` and returns it. */
export function installMemoryLocalStorage(): MemoryStorage {
  const storage = new MemoryStorage()
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
  return storage
}
