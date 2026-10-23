import Fastify, { type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import serveStatic from "@fastify/static";
import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Store, type Row } from "./db.js";
import { type Config, within } from "./config.js";
import { ApiError, projectSchema, parseInput, readRecipe } from "./yaml.js";
import { token, verifyPassword } from "./auth.js";
import { Runner } from "./runner.js";
import { readLogs } from "./logs.js";
export async function createApp(
  config: Config,
  options: { now?: () => number; startRunner?: boolean } = {},
) {
  const now = options.now ?? Date.now;
  const db = new Store(config.dataDir);
  const runner = new Runner(db, config);
  const app = Fastify({
    logger: false,
    bodyLimit: 300 * 1024,
    trustProxy: config.trustProxy.length ? config.trustProxy : false,
  });
  await app.register(cookie);
  app.addHook("onSend", async (_req, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "same-origin")
      .header("X-Frame-Options", "DENY")
      .header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
      );
  });
  app.setErrorHandler((error: any, _req, reply) => {
    const code =
      error.statusCode >= 400 && error.statusCode < 500
        ? error.statusCode
        : 503;
    reply
      .code(code)
      .send({
        message:
          code === 503 ? "Servicio temporalmente no disponible" : error.message,
        fields: error.fields,
      });
  });
  const sessions = new WeakMap<FastifyRequest, Row>();
  const session = (req: FastifyRequest) => {
    const row = req.cookies.sid
      ? db.get(
          "SELECT * FROM sessions WHERE id=? AND expires>?",
          req.cookies.sid,
          now(),
        )
      : undefined;
    if (!row) throw new ApiError(401, "Inicia sesión para continuar");
    return row;
  };
  const attempts = new Map<string, { count: number; until: number }>();
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api")) return;
    reply.header("Cache-Control", "no-store");
    const url = req.url.split("?")[0];
    if (url === "/api/login") return;
    const row = session(req);
    sessions.set(req, row);
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers["x-csrf-token"] !== row.csrf
    )
      throw new ApiError(403, "Token de seguridad inválido; recarga la sesión");
  });
  app.post("/api/login", async (req, reply) => {
    const current = now();
    let attempt = attempts.get(req.ip);
    if (!attempt || attempt.until <= current) {
      attempt = { count: 0, until: current + 15 * 60000 };
      attempts.set(req.ip, attempt);
    }
    if (attempt.count >= 10)
      throw new ApiError(429, "Demasiados intentos; espera quince minutos");
    attempt.count++;
    // Limitar tamaño del mapa sin reiniciar ventanas aún vigentes.
    for (const [key, value] of attempts)
      if (value.until <= current) attempts.delete(key);
    if (attempts.size > 10000)
      throw new ApiError(429, "Acceso temporalmente limitado");
    const body = parseInput(
      z
        .object({
          username: z.string().min(1).max(100),
          password: z.string().min(1).max(256),
        })
        .strict(),
      req.body,
    );
    const admin = db.get("SELECT * FROM admin WHERE id=1");
    const valid = verifyPassword(
      body.password,
      admin?.password ?? "invalid:00",
    );
    if (!admin || !valid || body.username !== admin.username)
      throw new ApiError(401, "Usuario o contraseña incorrectos");
    if (req.cookies.sid)
      db.run("DELETE FROM sessions WHERE id=?", req.cookies.sid);
    const id = token(),
      csrf = token();
    db.run(
      "INSERT INTO sessions(id,csrf,expires) VALUES(?,?,?)",
      id,
      csrf,
      current + 8 * 3600000,
    );
    reply.setCookie("sid", id, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: config.production,
      maxAge: 8 * 3600,
    });
    return { username: admin.username, csrf };
  });
  app.get("/api/session", async (req) => ({
    csrf: sessions.get(req)!.csrf,
    username: db.get("SELECT username FROM admin WHERE id=1")?.username,
  }));
  app.post("/api/logout", async (req, reply) => {
    db.run("DELETE FROM sessions WHERE id=?", sessions.get(req)!.id);
    reply.clearCookie("sid", { path: "/" });
    return { ok: true };
  });
  const project = (req: FastifyRequest) => {
    const { id } = req.params as { id: string };
    const p = db.get("SELECT * FROM projects WHERE id=?", id);
    if (!p) throw new ApiError(404, "Proyecto no encontrado");
    return p;
  };
  const page = (req: FastifyRequest) =>
    parseInput(
      z.object({
        offset: z.coerce.number().int().min(0).max(1000000).default(0),
      }),
      req.query ?? {},
    ).offset;
  app.get("/api/projects", async () =>
    db.all(
      `SELECT p.*,(SELECT status FROM deployments d WHERE d.projectId=p.id ORDER BY created DESC,rowid DESC LIMIT 1) AS lastStatus,(SELECT created FROM deployments d WHERE d.projectId=p.id ORDER BY created DESC,rowid DESC LIMIT 1) AS lastDeployment FROM projects p ORDER BY p.created DESC`,
    ),
  );
  const saveProject = (input: unknown, id?: string) => {
    const body = parseInput(projectSchema, input);
    if (!path.isAbsolute(body.root))
      throw new ApiError(400, "El directorio debe ser absoluto", {
        root: "Introduce una ruta absoluta",
      });
    let root: string;
    try {
      root = realpathSync(body.root);
    } catch {
      throw new ApiError(400, "Directorio inexistente o inaccesible", {
        root: "No se puede acceder al directorio",
      });
    }
    if (
      !statSync(root).isDirectory() ||
      !config.roots.some((r) => within(r, root))
    )
      throw new ApiError(400, "Directorio fuera de las raíces autorizadas", {
        root: "Directorio no autorizado",
      });
    if (within(root, config.dataDir) || within(config.dataDir, root))
      throw new ApiError(400, "El proyecto se solapa con los datos del panel");
    const recipe = readRecipe(root, body.yaml, body.type);
    void recipe;
    return db.transaction(() => {
      if (
        id &&
        db.get(
          "SELECT id FROM deployments WHERE projectId=? AND status IN ('pending','running')",
          id,
        )
      )
        throw new ApiError(
          409,
          "No puedes editar un proyecto con un despliegue activo",
        );
      for (const other of db.all("SELECT id,root FROM projects"))
        if (
          other.id !== id &&
          (within(root, other.root) || within(other.root, root))
        )
          throw new ApiError(409, "El directorio se solapa con otro proyecto", {
            root: "Ya está registrado este directorio o un directorio relacionado",
          });
      if (id)
        db.run(
          "UPDATE projects SET name=?,type=?,root=?,yaml=? WHERE id=?",
          body.name,
          body.type,
          root,
          body.yaml,
          id,
        );
      else {
        id = randomUUID();
        db.run(
          "INSERT INTO projects(id,name,type,root,yaml,created) VALUES(?,?,?,?,?,?)",
          id,
          body.name,
          body.type,
          root,
          body.yaml,
          now(),
        );
      }
      return db.get("SELECT * FROM projects WHERE id=?", id);
    });
  };
  app.post("/api/projects", async (req, reply) => {
    const result = saveProject(req.body);
    reply.code(201);
    return result;
  });
  app.put("/api/projects/:id", async (req) =>
    saveProject(req.body, project(req).id),
  );
  app.post("/api/projects/:id/validate", async (req) => {
    const p = project(req);
    runner.validateRoot(p);
    const recipe = readRecipe(p.root, p.yaml, p.type);
    return { valid: true, steps: recipe.steps.map((s) => s.id) };
  });
  app.post("/api/projects/:id/deploy", async (req, reply) => {
    const id = runner.accept(project(req));
    reply.code(202);
    return { id };
  });
  app.get("/api/projects/:id/deployments", async (req) => {
    const p = project(req),
      offset = page(req);
    return {
      items: db.all(
        "SELECT id,projectId,status,created,started,ended,reason,origin,hash FROM deployments WHERE projectId=? ORDER BY created DESC,rowid DESC LIMIT 25 OFFSET ?",
        p.id,
        offset,
      ),
      offset,
    };
  });
  const deployment = (req: FastifyRequest) => {
    const { id } = req.params as { id: string };
    const row = db.get(
      "SELECT id,projectId,status,created,started,ended,reason,origin,hash FROM deployments WHERE id=?",
      id,
    );
    if (!row) throw new ApiError(404, "Despliegue no encontrado");
    return row;
  };
  app.get("/api/deployments/:id", async (req) => {
    const row = deployment(req);
    return {
      ...row,
      steps: db.all(
        "SELECT * FROM steps WHERE deploymentId=? ORDER BY position",
        row.id,
      ),
    };
  });
  app.get("/api/deployments/:id/logs", async (req) => {
    const row = deployment(req);
    const { cursor } = parseInput(
      z.object({
        cursor: z.coerce
          .number()
          .int()
          .min(0)
          .max(11 * 1024 * 1024)
          .default(0),
      }),
      req.query,
    );
    return readLogs(path.join(config.dataDir, "logs"), row.id, cursor);
  });
  app.get("/api/health", async () => ({
    ok: !runner.fatal,
    runner: runner.fatal ? "unavailable" : "ready",
  }));
  const clientDir = fileURLToPath(new URL("../client/", import.meta.url));
  // En dist/server el cliente está en dist/client; en desarrollo lo sirve Vite.
  if (
    existsSync(path.join(clientDir, "index.html")) &&
    clientDir.includes(`${path.sep}dist${path.sep}`)
  ) {
    await app.register(serveStatic, { root: clientDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (
        req.url.startsWith("/api") ||
        req.method !== "GET" ||
        !req.headers.accept?.includes("text/html")
      )
        return reply.code(404).send({ message: "Ruta no encontrada" });
      return reply.sendFile("index.html");
    });
  } else
    app.setNotFoundHandler((_req, reply) =>
      reply.code(404).send({ message: "Ruta no encontrada" }),
    );
  if (options.startRunner !== false) runner.start();
  app.addHook("onClose", async () => {
    await runner.close();
    db.close();
  });
  return { app, db, runner };
}
