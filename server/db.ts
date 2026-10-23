import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
export type Row = Record<string, any>;
export class Store {
  db: DatabaseSync;
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(dir, "lucudeploy.sqlite"));
    chmodSync(path.join(dir, "lucudeploy.sqlite"), 0o600);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    if (
      Number(
        (this.db.prepare("PRAGMA user_version").get() as Row).user_version,
      ) < 1
    )
      this.db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE admin (id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL, password TEXT NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, root TEXT NOT NULL UNIQUE, yaml TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE deployments (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id), snapshot TEXT NOT NULL, hash TEXT NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL, started INTEGER, ended INTEGER, reason TEXT, pid INTEGER, origin TEXT NOT NULL DEFAULT 'manual');
      CREATE UNIQUE INDEX active_project ON deployments(projectId) WHERE status IN ('pending','running');
      CREATE TABLE steps (deploymentId TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE, position INTEGER NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL, started INTEGER, ended INTEGER, code INTEGER, reason TEXT, PRIMARY KEY(deploymentId,position));
      PRAGMA user_version=1;
      COMMIT;
    `);
  }
  all(sql: string, ...values: any[]): Row[] {
    return this.db.prepare(sql).all(...values) as Row[];
  }
  get(sql: string, ...values: any[]): Row | undefined {
    return this.db.prepare(sql).get(...values) as Row | undefined;
  }
  run(sql: string, ...values: any[]) {
    return this.db.prepare(sql).run(...values);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  close() {
    this.db.close();
  }
}
