import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  existsSync,
  statSync,
  rmSync,
  realpathSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../server/config.js";
import { Store } from "../server/db.js";
import { readRecipe } from "../server/yaml.js";
import { Runner } from "../server/runner.js";
import { Redactor, LogWriter, readLogs } from "../server/logs.js";
import { createApp } from "../server/app.js";
import { passwordHash } from "../server/auth.js";
const temp = () =>
  realpathSync(mkdtempSync(path.join(os.tmpdir(), "lucudeploy-test-")));
function fixture() {
  const base = temp();
  mkdirSync(path.join(base, "apps"));
  mkdirSync(path.join(base, "apps", "demo"));
  const root = path.join(base, "apps", "demo");
  const config = loadConfig({
    DEPLOY_ROOTS: path.join(base, "apps"),
    DATA_DIR: path.join(base, "data"),
  });
  return { base, root, config };
}
const recipe = (steps: any[], type = "node") =>
  JSON.stringify({ version: 1, type, steps });
const step = (id = "verify", script = 'console.log("ok")', extra = {}) => ({
  id,
  command: process.execPath,
  args: ["-e", script],
  ...extra,
});
const wait = async (runner: Runner) => {
  const deadline = Date.now() + 15000;
  while (runner.busy) {
    if (Date.now() > deadline) throw new Error("El trabajador no terminó");
    await new Promise((r) => setTimeout(r, 20));
  }
};
function setupRunner(steps: any[]) {
  const f = fixture();
  writeFileSync(path.join(f.root, "deploy.yml"), recipe(steps));
  const db = new Store(f.config.dataDir);
  db.run(
    "INSERT INTO projects(id,name,type,root,yaml,created) VALUES(?,?,?,?,?,?)",
    "p",
    "Demo",
    "node",
    f.root,
    "deploy.yml",
    Date.now(),
  );
  const runner = new Runner(db, f.config);
  runner.start();
  return {
    ...f,
    db,
    runner,
    project: db.get("SELECT * FROM projects WHERE id=?", "p")!,
  };
}
test("config valida límites, raíces y separación de datos", () => {
  const f = fixture();
  assert.equal(f.config.retentionDays, 30);
  assert.throws(() => loadConfig({ DEPLOY_ROOTS: "/no/existe" }));
  assert.throws(() =>
    loadConfig({
      DEPLOY_ROOTS: f.root,
      DATA_DIR: path.join(f.base, "x"),
      PORT: "0",
    }),
  );
  assert.throws(() =>
    loadConfig({ DEPLOY_ROOTS: f.root, DATA_DIR: path.join(f.root, "data") }),
  );
  rmSync(f.base, { recursive: true });
});
test("SQLite migra y reabre datos con índice de exclusión", () => {
  const f = fixture();
  let db = new Store(f.config.dataDir);
  db.run(
    "INSERT INTO projects VALUES(?,?,?,?,?,?)",
    "p",
    "Demo",
    "node",
    f.root,
    "deploy.yml",
    0,
  );
  db.run(
    "INSERT INTO deployments(id,projectId,snapshot,hash,status,created) VALUES(?,?,?,?,?,?)",
    "a",
    "p",
    "{}",
    "x",
    "pending",
    0,
  );
  assert.throws(() =>
    db.run(
      "INSERT INTO deployments(id,projectId,snapshot,hash,status,created) VALUES(?,?,?,?,?,?)",
      "b",
      "p",
      "{}",
      "x",
      "pending",
      0,
    ),
  );
  db.close();
  db = new Store(f.config.dataDir);
  assert.equal(db.get("SELECT COUNT(*) n FROM projects")!.n, 1);
  db.close();
  rmSync(f.base, { recursive: true });
});
test("YAML estricto: tipos, claves, alias, tamaño, rutas, secretos y verify", () => {
  const f = fixture();
  const file = path.join(f.root, "deploy.yml");
  const check = (text: string) => {
    writeFileSync(file, text);
    return () => readRecipe(f.root, "deploy.yml", "node", {});
  };
  assert.equal(check(recipe([step()]))().steps[0].timeoutSeconds, 600);
  for (const text of [
    "version: 1\nversion: 1\n",
    "a: &a 1\nb: *a",
    "value: !evil foo",
    recipe([step("build")]),
    JSON.stringify({
      version: 1,
      type: "node",
      steps: [step()],
      unknown: true,
    }),
    recipe([step("verify", "", { cwd: "../.." })]),
    recipe([step("verify", "", { env: { SECRET: { fromEnv: "MISSING" } } })]),
    recipe([step()], "laravel"),
    "x".repeat(256 * 1024 + 1),
  ])
    assert.throws(check(text));
  assert.throws(check(recipe([step("verify", "", { cwd: "/tmp" })])));
  const outside = path.join(f.base, "outside");
  mkdirSync(outside);
  symlinkSync(outside, path.join(f.root, "escape"));
  assert.throws(check(recipe([step("verify", "", { cwd: "escape" })])));
  rmSync(f.base, { recursive: true });
});
test("redacción incremental preserva UTF-8, fragmentos y canales; logs limitados", () => {
  const redact = new Redactor(["secret", "secreto-largo"]);
  assert.equal(redact.push("hola sec"), "hola ");
  assert.equal(redact.push("ret y secreto-"), "[OCULTO] y ");
  assert.equal(redact.push("largo", true), "[OCULTO]");
  const base = temp();
  const writer = new LogWriter(base, "id", ["clave"], 1500);
  writer.push("verify", "stdout", Buffer.from("cl"));
  writer.push("verify", "stderr", Buffer.from("<script>x</script>"));
  writer.push("verify", "stdout", Buffer.from("ave á"));
  writer.finish("verify");
  const logs = readFileSync(writer.file, "utf8");
  assert(!logs.includes("clave"));
  assert(logs.includes("[OCULTO]"));
  assert(logs.includes("á"));
  writer.push("other", "stdout", Buffer.from("x".repeat(50000)));
  writer.finish("other");
  assert(statSync(writer.file).size <= 1500);
  assert(readFileSync(writer.file, "utf8").includes("truncada"));
  assert(readLogs(base, "id", 0).entries.length > 0);
  rmSync(base, { recursive: true });
});
test("ejecución acepta instantánea, rechaza concurrencia y guarda éxito", async () => {
  const f = setupRunner([
    step("build", 'setTimeout(()=>console.log("build"),80)'),
    step(),
  ]);
  try {
    const id = f.runner.accept(f.project);
    assert.throws(() => f.runner.accept(f.project), /activa/);
    writeFileSync(path.join(f.root, "deploy.yml"), "INVALID");
    await wait(f.runner);
    assert.equal(
      f.db.get("SELECT status FROM deployments WHERE id=?", id)!.status,
      "success",
    );
    assert.equal(
      f.db.all("SELECT * FROM steps WHERE deploymentId=?", id).length,
      2,
    );
    assert(
      readLogs(path.join(f.config.dataDir, "logs"), id, 0).entries.length > 0,
    );
  } finally {
    await f.runner.close();
    f.db.close();
    rmSync(f.base, { recursive: true });
  }
});
test("fallo no ejecuta pasos siguientes y argumentos no pasan por shell", async () => {
  const f = setupRunner([
    step("build", "process.exit(7)"),
    step("verify", `require('fs').writeFileSync('should-not-exist','bad')`),
  ]);
  try {
    const id = f.runner.accept(f.project);
    await wait(f.runner);
    assert.equal(
      f.db.get("SELECT status FROM deployments WHERE id=?", id)!.status,
      "failed",
    );
    assert.equal(
      f.db.get(
        "SELECT status FROM steps WHERE deploymentId=? AND position=1",
        id,
      )!.status,
      "skipped",
    );
    assert(!existsSync(path.join(f.root, "should-not-exist")));
    writeFileSync(
      path.join(f.root, "deploy.yml"),
      recipe([
        {
          id: "verify",
          command: process.execPath,
          args: [
            "-e",
            "console.log(process.argv[1])",
            "$(touch injected); echo x",
          ],
        },
      ]),
    );
    const second = f.runner.accept(f.project);
    await wait(f.runner);
    assert.equal(
      f.db.get("SELECT status FROM deployments WHERE id=?", second)!.status,
      "success",
    );
    assert(!existsSync(path.join(f.root, "injected")));
    assert(
      readFileSync(
        path.join(f.config.dataDir, "logs", `${second}.jsonl`),
        "utf8",
      ).includes("$(touch injected)"),
    );
  } finally {
    await f.runner.close();
    f.db.close();
    rmSync(f.base, { recursive: true });
  }
});
test("timeout termina grupo y permite siguiente despliegue", async () => {
  const f = setupRunner([
    step(
      "verify",
      `require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});setInterval(()=>{},1000)`,
      { timeoutSeconds: 1 },
    ),
  ]);
  try {
    const id = f.runner.accept(f.project);
    await wait(f.runner);
    assert.equal(
      f.db.get("SELECT reason FROM deployments WHERE id=?", id)!.reason,
      "Timeout",
    );
    writeFileSync(path.join(f.root, "deploy.yml"), recipe([step()]));
    const next = f.runner.accept(f.project);
    await wait(f.runner);
    assert.equal(
      f.db.get("SELECT status FROM deployments WHERE id=?", next)!.status,
      "success",
    );
  } finally {
    await f.runner.close();
    f.db.close();
    rmSync(f.base, { recursive: true });
  }
});
test("fallo de inicio y fallo de logs nunca dan éxito", async () => {
  const f = setupRunner([
    { id: "verify", command: "/no/executable", args: [] },
  ]);
  try {
    const id = f.runner.accept(f.project);
    await wait(f.runner);
    assert.equal(
      f.db.get("SELECT status FROM deployments WHERE id=?", id)!.status,
      "failed",
    );
    writeFileSync(path.join(f.root, "deploy.yml"), recipe([step()]));
    rmSync(path.join(f.config.dataDir, "logs"), { recursive: true });
    writeFileSync(path.join(f.config.dataDir, "logs"), "not a directory");
    const next = f.runner.accept(f.project);
    await wait(f.runner);
    assert.equal(
      f.db.get("SELECT status FROM deployments WHERE id=?", next)!.status,
      "failed",
    );
  } finally {
    await f.runner.close();
    f.db.close();
    rmSync(f.base, { recursive: true });
  }
});
test("retención y recuperación no reejecutan comandos", async () => {
  const f = setupRunner([step()]);
  try {
    const id = f.runner.accept(f.project);
    await wait(f.runner);
    f.db.run("UPDATE deployments SET ended=0 WHERE id=?", id);
    f.runner.cleanup(Date.now());
    assert(!f.db.get("SELECT * FROM deployments WHERE id=?", id));
    assert(!existsSync(path.join(f.config.dataDir, "logs", `${id}.jsonl`)));
    f.db.run(
      "INSERT INTO deployments(id,projectId,snapshot,hash,status,created) VALUES(?,?,?,?,?,?)",
      "old",
      "p",
      "{}",
      "hash",
      "pending",
      0,
    );
    f.runner.cleanup();
    assert(f.db.get("SELECT id FROM deployments WHERE id=?", "old"));
    f.runner.recover();
    assert.equal(
      f.db.get("SELECT status FROM deployments WHERE id=?", "old")!.status,
      "interrupted",
    );
    f.db.run(
      "UPDATE deployments SET status='running',pid=? WHERE id='old'",
      process.pid,
    );
    if (process.platform !== "win32") {
      // un grupo real se verifica con proceso detached en integración Linux
      f.db.run("UPDATE deployments SET pid=NULL WHERE id='old'");
      f.runner.recover();
    }
  } finally {
    await f.runner.close();
    f.db.close();
    rmSync(f.base, { recursive: true });
  }
});
test("API: sesiones, CSRF, rutas, validación, conflicto, expiración y límite", async () => {
  const f = fixture();
  writeFileSync(
    path.join(f.root, "deploy.yml"),
    recipe([step("verify", "setTimeout(()=>{},200)")]),
  );
  let now = Date.now();
  const { app, db, runner } = await createApp(f.config, { now: () => now });
  db.run(
    "INSERT INTO admin VALUES(1,?,?)",
    "admin",
    passwordHash("test-password-123"),
  );
  try {
    assert.equal(
      (await app.inject({ method: "GET", url: "/api/projects" })).statusCode,
      401,
    );
    const bad = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { username: "admin", password: "wrong" },
    });
    assert.equal(bad.statusCode, 401);
    const login = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { username: "admin", password: "test-password-123" },
    });
    assert.equal(login.statusCode, 200);
    assert(String(login.headers["set-cookie"]).includes("HttpOnly"));
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    const headers = { cookie, "x-csrf-token": login.json().csrf };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/projects",
          headers: { cookie },
          payload: {},
        })
      ).statusCode,
      403,
    );
    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers,
      payload: { name: "Demo", type: "node", root: f.root, yaml: "deploy.yml" },
    });
    assert.equal(created.statusCode, 201, created.body);
    const id = created.json().id;
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/projects",
          headers,
          payload: {
            name: "Duplicate",
            type: "node",
            root: f.root,
            yaml: "deploy.yml",
          },
        })
      ).statusCode,
      409,
    );
    const outside = path.join(f.base, "outside");
    mkdirSync(outside);
    symlinkSync(outside, path.join(f.root, "escape"));
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/projects",
          headers,
          payload: {
            name: "Escape",
            type: "node",
            root: path.join(f.root, "escape"),
            yaml: "deploy.yml",
          },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${id}/validate`,
          headers,
        })
      ).statusCode,
      200,
    );
    const deploy = await app.inject({
      method: "POST",
      url: `/api/projects/${id}/deploy`,
      headers,
    });
    assert.equal(deploy.statusCode, 202);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${id}/deploy`,
          headers,
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: `/api/projects/${id}`,
          headers,
          payload: {
            name: "New",
            type: "node",
            root: f.root,
            yaml: "deploy.yml",
          },
        })
      ).statusCode,
      409,
    );
    await wait(runner);
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: `/api/deployments/${deploy.json().id}`,
          headers,
        })
      ).json().status,
      "success",
    );
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: "/api/missing",
          headers: { ...headers, accept: "text/html" },
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (await app.inject({ method: "POST", url: "/api/logout", headers }))
        .statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ method: "GET", url: "/api/session", headers }))
        .statusCode,
      401,
    );
    const login2 = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { username: "admin", password: "test-password-123" },
    });
    now += 8 * 3600000 + 1;
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: "/api/session",
          headers: {
            cookie: String(login2.headers["set-cookie"]).split(";")[0],
          },
        })
      ).statusCode,
      401,
    );
    for (let i = 0; i < 10; i++)
      await app.inject({
        method: "POST",
        url: "/api/login",
        payload: { username: "admin", password: "wrong" },
      });
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/login",
          payload: { username: "admin", password: "test-password-123" },
        })
      ).statusCode,
      429,
    );
    now += 15 * 60000 + 1;
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/login",
          payload: { username: "admin", password: "test-password-123" },
        })
      ).statusCode,
      200,
    );
  } finally {
    await app.close();
    rmSync(f.base, { recursive: true });
  }
});
test("recetas entregadas cumplen el contrato para los tres tipos", () => {
  const f = fixture();
  try {
    for (const type of ["node", "laravel", "wordpress"]) {
      writeFileSync(
        path.join(f.root, "deploy.yml"),
        readFileSync(
          new URL(`../examples/${type}.deploy.yml`, import.meta.url),
          "utf8",
        ),
      );
      assert.equal(readRecipe(f.root, "deploy.yml", type).type, type);
    }
  } finally {
    rmSync(f.base, { recursive: true });
  }
});
test("cola entre proyectos es secuencial y recuperación bloquea grupos vivos", async () => {
  const f = setupRunner([step("verify", "setTimeout(()=>{},150)")]);
  try {
    const root2 = path.join(f.base, "apps", "second");
    mkdirSync(root2);
    writeFileSync(path.join(root2, "deploy.yml"), recipe([step()]));
    f.db.run(
      "INSERT INTO projects VALUES(?,?,?,?,?,?)",
      "second",
      "Segundo",
      "node",
      root2,
      "deploy.yml",
      Date.now(),
    );
    const first = f.runner.accept(f.project);
    const second = f.runner.accept(
      f.db.get("SELECT * FROM projects WHERE id=?", "second")!,
    );
    assert.equal(
      f.db.get("SELECT status FROM deployments WHERE id=?", second)!.status,
      "pending",
    );
    await wait(f.runner);
    assert(
      f.db.get("SELECT ended FROM deployments WHERE id=?", first)!.ended <=
        f.db.get("SELECT started FROM deployments WHERE id=?", second)!.started,
    );
  } finally {
    await f.runner.close();
    f.db.close();
    rmSync(f.base, { recursive: true });
  }
});
test("recuperación falla cerrada mientras hay un grupo anterior vivo", async () => {
  const { spawn } = await import("node:child_process");
  const f = setupRunner([step()]);
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    detached: true,
    stdio: "ignore",
  });
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    f.db.run(
      "INSERT INTO deployments(id,projectId,snapshot,hash,status,created,pid) VALUES(?,?,?,?,?,?,?)",
      "orphan",
      "p",
      "{}",
      "hash",
      "running",
      0,
      child.pid!,
    );
    assert.throws(() => f.runner.recover(), /procesos/);
    assert.equal(
      f.db.get("SELECT status FROM deployments WHERE id=?", "orphan")!.status,
      "running",
    );
    process.kill(-child.pid!, "SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
    f.runner.recover();
    assert.equal(
      f.db.get("SELECT status FROM deployments WHERE id=?", "orphan")!.status,
      "interrupted",
    );
  } finally {
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {}
    await f.runner.close();
    f.db.close();
    rmSync(f.base, { recursive: true });
  }
});
