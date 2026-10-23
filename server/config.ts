import { realpathSync, statSync, mkdirSync } from "node:fs";
import path from "node:path";
export interface Config {
  host: string;
  port: number;
  dataDir: string;
  roots: string[];
  retentionDays: number;
  production: boolean;
  trustProxy: string[];
}
export function within(root: string, target: string) {
  const rel = path.relative(root, target);
  return (
    rel === "" ||
    (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel))
  );
}
export function loadConfig(env = process.env): Config {
  const integer = (key: string, fallback: number, max: number) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isInteger(value) || value < 1 || value > max)
      throw new Error(`${key} inválido`);
    return value;
  };
  const roots = (env.DEPLOY_ROOTS ?? "")
    .split(",")
    .filter(Boolean)
    .map((p) => {
      const root = realpathSync(p.trim());
      if (!statSync(root).isDirectory())
        throw new Error("DEPLOY_ROOTS debe contener directorios");
      return root;
    });
  if (!roots.length)
    throw new Error("Configura DEPLOY_ROOTS con al menos una raíz existente");
  const dataDir = path.resolve(env.DATA_DIR ?? ".data");
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const actualDataDir = realpathSync(dataDir);
  if (roots.some((r) => within(r, actualDataDir) || within(actualDataDir, r)))
    throw new Error("DATA_DIR debe estar separado de DEPLOY_ROOTS");
  return {
    host: env.HOST ?? "127.0.0.1",
    port: integer("PORT", 3400, 65535),
    dataDir: actualDataDir,
    roots,
    retentionDays: integer("RETENTION_DAYS", 30, 3650),
    production: env.NODE_ENV === "production",
    trustProxy: (env.TRUST_PROXY ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
