import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";

type Param = SQLInputValue | boolean | undefined;
export type Params = readonly Param[] | Record<string, Param>;

function bind(value: Param): SQLInputValue {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

/**
 * Thin synchronous wrapper over Node's built-in SQLite (node:sqlite).
 *
 * All access happens on the Electron main process, one call at a time, so a
 * synchronous driver gives us simple, strictly ordered transactions with no
 * connection pool and no native module to rebuild for each platform.
 */
export class Db {
  readonly raw: DatabaseSync;
  readonly path: string;
  private readonly cache = new Map<string, StatementSync>();
  private depth = 0;

  constructor(path: string) {
    this.path = path;
    this.raw = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    this.raw.exec("PRAGMA foreign_keys = ON");
    this.raw.exec("PRAGMA busy_timeout = 5000");
    if (path !== ":memory:") {
      this.raw.exec("PRAGMA journal_mode = WAL");
      this.raw.exec("PRAGMA synchronous = FULL");
    }
  }

  private stmt(sql: string): StatementSync {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  private readonly names = new Map<string, string[]>();

  /**
   * Named parameters are bound strictly: keys the statement doesn't use are
   * dropped (so callers can pass a whole input object), and a parameter the
   * statement uses but the caller forgot is an error — node:sqlite would
   * otherwise silently bind NULL.
   */
  private args(sql: string, params?: Params): SQLInputValue[] {
    if (!params) return [];
    if (Array.isArray(params)) return (params as readonly Param[]).map(bind);
    let wanted = this.names.get(sql);
    if (!wanted) {
      wanted = [...new Set([...sql.matchAll(/[$:@]([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]))];
      this.names.set(sql, wanted);
    }
    const source = params as Record<string, Param>;
    const named: Record<string, SQLInputValue> = {};
    for (const key of wanted) {
      if (!(key in source)) throw new Error(`Missing SQL parameter "${key}"`);
      named[key] = bind(source[key]);
    }
    return [named as unknown as SQLInputValue];
  }

  run(sql: string, params?: Params): { changes: number } {
    const r = this.stmt(sql).run(...this.args(sql, params));
    return { changes: Number(r.changes) };
  }

  get<T>(sql: string, params?: Params): T | undefined {
    return this.stmt(sql).get(...this.args(sql, params)) as T | undefined;
  }

  all<T>(sql: string, params?: Params): T[] {
    return this.stmt(sql).all(...this.args(sql, params)) as T[];
  }

  exec(sql: string) {
    this.raw.exec(sql);
  }

  /** Run `fn` atomically. Nested calls use savepoints. */
  tx<T>(fn: () => T): T {
    const name = `sp${this.depth}`;
    this.raw.exec(this.depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${name}`);
    this.depth++;
    try {
      const result = fn();
      this.depth--;
      this.raw.exec(this.depth === 0 ? "COMMIT" : `RELEASE ${name}`);
      return result;
    } catch (err) {
      this.depth--;
      this.raw.exec(this.depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${name}; RELEASE ${name}`);
      throw err;
    }
  }

  get inTransaction(): boolean {
    return this.depth > 0;
  }

  close() {
    this.cache.clear();
    try {
      if (this.path !== ":memory:") this.raw.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      this.raw.close();
    }
  }
}
