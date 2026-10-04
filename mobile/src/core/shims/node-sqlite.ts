// The slice of node:sqlite that ../desktop/core/db.ts uses, on expo-sqlite's
// synchronous API. Both are synchronous, so the core's transactions keep
// their exact semantics.
import { openDatabaseSync, type SQLiteBindParams, type SQLiteBindValue, type SQLiteDatabase, type SQLiteStatement } from "expo-sqlite";

export type SQLInputValue = null | number | bigint | string | Uint8Array;

type Bound = SQLInputValue[] | [Record<string, SQLInputValue>];

function toExpoValue(v: SQLInputValue): SQLiteBindValue {
  return typeof v === "bigint" ? Number(v) : v;
}

export class StatementSync {
  private readonly stmt: SQLiteStatement;
  // node:sqlite binds `{ name }` to `$name`/`:name`/`@name`; expo-sqlite wants the prefix in the key.
  private readonly prefixes = new Map<string, string[]>();

  constructor(db: SQLiteDatabase, sql: string) {
    this.stmt = db.prepareSync(sql);
    for (const m of sql.matchAll(/([$:@])([A-Za-z_][A-Za-z0-9_]*)/g)) {
      const list = this.prefixes.get(m[2]) ?? [];
      if (!list.includes(m[1])) list.push(m[1]);
      this.prefixes.set(m[2], list);
    }
  }

  private params(args: Bound): SQLiteBindParams {
    const first = args[0];
    if (args.length === 1 && first !== null && typeof first === "object" && !(first instanceof Uint8Array)) {
      const out: Record<string, SQLiteBindValue> = {};
      for (const [key, value] of Object.entries(first as Record<string, SQLInputValue>)) {
        for (const prefix of this.prefixes.get(key) ?? []) out[`${prefix}${key}`] = toExpoValue(value);
      }
      return out;
    }
    return (args as SQLInputValue[]).map(toExpoValue);
  }

  // node:sqlite resets a statement as soon as it has its rows; expo-sqlite
  // leaves the cursor open, which locks tables against DDL and COMMIT.
  run(...args: Bound): { changes: number; lastInsertRowid: number } {
    const r = this.stmt.executeSync(this.params(args));
    try {
      return { changes: r.changes, lastInsertRowid: r.lastInsertRowId };
    } finally {
      r.resetSync();
    }
  }

  get(...args: Bound): Record<string, unknown> | undefined {
    const r = this.stmt.executeSync<Record<string, unknown>>(this.params(args));
    try {
      return r.getFirstSync() ?? undefined;
    } finally {
      r.resetSync();
    }
  }

  all(...args: Bound): Record<string, unknown>[] {
    const r = this.stmt.executeSync<Record<string, unknown>>(this.params(args));
    try {
      return r.getAllSync();
    } finally {
      r.resetSync();
    }
  }

  finalize() {
    this.stmt.finalizeSync();
  }
}

export class DatabaseSync {
  private readonly db: SQLiteDatabase;
  private readonly statements: StatementSync[] = [];

  /** `path` is an absolute file path; expo-sqlite takes a name plus a directory. */
  constructor(path: string, _opts?: { enableForeignKeyConstraints?: boolean }) {
    if (path === ":memory:") {
      this.db = openDatabaseSync(":memory:");
    } else {
      const slash = path.lastIndexOf("/");
      this.db = openDatabaseSync(path.slice(slash + 1), undefined, path.slice(0, slash));
    }
  }

  exec(sql: string) {
    this.db.execSync(sql);
  }

  prepare(sql: string): StatementSync {
    const s = new StatementSync(this.db, sql);
    this.statements.push(s);
    return s;
  }

  close() {
    for (const s of this.statements.splice(0)) s.finalize();
    this.db.closeSync();
  }
}
