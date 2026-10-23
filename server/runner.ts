import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { Store, type Row } from "./db.js";
import { localPath, readRecipe, ApiError, type Recipe } from "./yaml.js";
import { within, type Config } from "./config.js";
import { LogWriter, removeLogs } from "./logs.js";
export class Runner {
  busy = false;
  stopped = false;
  fatal: string | null = null;
  private active: AbortController | null = null;
  private timer?: ReturnType<typeof setInterval>;
  constructor(
    public db: Store,
    public config: Config,
  ) {}
  recover() {
    const active = this.db.all(
      "SELECT * FROM deployments WHERE status IN ('pending','running')",
    );
    for (const job of active)
      if (job.pid) {
        try {
          process.kill(-Number(job.pid), 0);
          throw new Error(
            "Hay procesos de una ejecución anterior; detén su grupo antes de arrancar",
          );
        } catch (e: any) {
          if (e.code !== "ESRCH") throw e;
        }
      }
    this.db.transaction(() => {
      const now = Date.now();
      this.db.run(
        "UPDATE steps SET status='interrupted',ended=?,reason='Servicio reiniciado' WHERE status='running'",
        now,
      );
      this.db.run(
        "UPDATE steps SET status='skipped',ended=? WHERE status='pending' AND deploymentId IN (SELECT id FROM deployments WHERE status IN ('pending','running'))",
        now,
      );
      this.db.run(
        "UPDATE deployments SET status='interrupted',ended=?,reason='Servicio reiniciado',pid=NULL WHERE status IN ('pending','running')",
        now,
      );
    });
  }
  start() {
    this.recover();
    this.cleanup();
    this.timer = setInterval(
      () => {
        try {
          this.cleanup();
        } catch {
          this.fatal = "No se pudo aplicar la retención";
        }
      },
      60 * 60 * 1000,
    );
    this.timer.unref();
  }
  validateRoot(project: Row) {
    const root = realpathSync(project.root);
    if (
      root !== project.root ||
      !this.config.roots.some((r) => within(r, root))
    )
      throw new ApiError(
        400,
        "La raíz del proyecto cambió o no está autorizada",
      );
    return root;
  }
  accept(
    project: Row,
    trigger?: {
      provider?: "github" | "gitlab";
      delivery: string;
      payloadHash: string;
    },
  ) {
    if (this.fatal || this.stopped)
      throw new ApiError(503, "Ejecutor no disponible");
    const root = this.validateRoot(project);
    const recipe = readRecipe(root, project.yaml, project.type);
    const snapshot = JSON.stringify(recipe);
    const id = randomUUID();
    this.db.transaction(() => {
      const active = this.db.get(
        "SELECT id FROM deployments WHERE projectId=? AND status IN ('pending','running')",
        project.id,
      );
      if (active)
        throw new ApiError(409, `Ya existe una ejecución activa: ${active.id}`);
      this.db.run(
        "INSERT INTO deployments(id,projectId,snapshot,hash,status,created,origin) VALUES(?,?,?,?,?,?,?)",
        id,
        project.id,
        snapshot,
        createHash("sha256").update(snapshot).digest("hex"),
        "pending",
        Date.now(),
        trigger ? (trigger.provider ?? "github") : "manual",
      );
      if (trigger)
        this.db.run(
          "INSERT INTO webhook_deliveries(projectId,delivery,payloadHash,deploymentId,created,provider) VALUES(?,?,?,?,?,?)",
          project.id,
          trigger.delivery,
          trigger.payloadHash,
          id,
          Date.now(),
          trigger.provider ?? "github",
        );
      recipe.steps.forEach((s, i) =>
        this.db.run(
          "INSERT INTO steps(deploymentId,position,name,status) VALUES(?,?,?,?)",
          id,
          i,
          s.id,
          "pending",
        ),
      );
    });
    void this.pump();
    return id;
  }
  async pump() {
    if (this.busy || this.stopped || this.fatal) return;
    this.busy = true;
    try {
      let job: Row | undefined;
      while (
        !this.stopped &&
        !this.fatal &&
        (job = this.db.get(
          "SELECT * FROM deployments WHERE status='pending' ORDER BY created,rowid LIMIT 1",
        ))
      )
        await this.execute(job);
    } catch {
      this.fatal = "Fallo de almacenamiento: ejecutor detenido";
      this.active?.abort();
    } finally {
      this.busy = false;
    }
  }
  async execute(job: Row) {
    const project = this.db.get(
      "SELECT * FROM projects WHERE id=?",
      job.projectId,
    )!;
    const recipe = JSON.parse(job.snapshot) as Recipe;
    let writer: LogWriter | undefined;
    let failure: string | undefined;
    this.db.run(
      "UPDATE deployments SET status='running',started=? WHERE id=?",
      Date.now(),
      job.id,
    );
    try {
      const secrets = recipe.steps.flatMap((s) =>
        Object.values(s.env).map((ref) => {
          const value = process.env[ref.fromEnv];
          if (!value) throw new Error(`Variable no disponible: ${ref.fromEnv}`);
          return value;
        }),
      );
      writer = new LogWriter(
        path.join(this.config.dataDir, "logs"),
        job.id,
        secrets,
      );
      for (let i = 0; i < recipe.steps.length; i++) {
        if (this.stopped) throw new Error("Servicio detenido");
        const step = recipe.steps[i];
        this.db.run(
          "UPDATE steps SET status='running',started=? WHERE deploymentId=? AND position=?",
          Date.now(),
          job.id,
          i,
        );
        try {
          const root = this.validateRoot(project);
          const cwd = localPath(root, step.cwd, true);
          const env: NodeJS.ProcessEnv = {
            PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
            LANG: "C.UTF-8",
          };
          for (const [key, ref] of Object.entries(step.env)) {
            const value = process.env[ref.fromEnv];
            if (!value)
              throw new Error(`Variable no disponible: ${ref.fromEnv}`);
            env[key] = value;
          }
          const result = await this.process(job.id, step, cwd, env, writer);
          writer.finish(step.id);
          this.db.run(
            "UPDATE steps SET status=?,ended=?,code=?,reason=? WHERE deploymentId=? AND position=?",
            result.reason ? "failed" : "success",
            Date.now(),
            result.code,
            result.reason ?? null,
            job.id,
            i,
          );
          if (result.reason) {
            failure = result.reason;
            break;
          }
        } catch {
          try {
            writer.finish(step.id);
          } catch {}
          this.db.run(
            "UPDATE steps SET status='failed',ended=?,reason='Fallo de ejecución, rutas o almacenamiento' WHERE deploymentId=? AND position=?",
            Date.now(),
            job.id,
            i,
          );
          failure = "Fallo de ejecución, rutas o almacenamiento";
          break;
        }
      }
    } catch {
      failure = "No se pudo iniciar o persistir el despliegue";
    }
    this.db.transaction(() => {
      this.db.run(
        "UPDATE steps SET status='skipped',ended=? WHERE deploymentId=? AND status='pending'",
        Date.now(),
        job.id,
      );
      this.db.run(
        "UPDATE deployments SET status=?,ended=?,reason=?,pid=NULL WHERE id=?",
        this.stopped ? "interrupted" : failure ? "failed" : "success",
        Date.now(),
        failure ?? null,
        job.id,
      );
    });
  }
  process(
    jobId: string,
    step: Recipe["steps"][number],
    cwd: string,
    env: NodeJS.ProcessEnv,
    writer: LogWriter,
  ): Promise<{ code: number | null; reason?: string }> {
    return new Promise((resolve) => {
      let reason: string | undefined;
      let settled = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const child = spawn(step.command, step.args, {
        cwd,
        env,
        shell: false,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const abort = new AbortController();
      this.active = abort;
      const killGroup = (signal: NodeJS.Signals) => {
        if (child.pid)
          try {
            process.kill(-child.pid, signal);
          } catch (e: any) {
            if (e.code !== "ESRCH") reason = "No se pudo terminar el grupo";
          }
      };
      const stop = (why: string) => {
        if (reason) return;
        reason = why;
        killGroup("SIGTERM");
        killTimer = setTimeout(() => killGroup("SIGKILL"), 5000);
      };
      abort.signal.addEventListener("abort", () => stop("Servicio detenido"));
      const timeout = setTimeout(
        () => stop("Timeout"),
        step.timeoutSeconds * 1000,
      );
      child.once("spawn", () => {
        try {
          this.db.run(
            "UPDATE deployments SET pid=? WHERE id=?",
            child.pid!,
            jobId,
          );
        } catch {
          stop("Fallo de almacenamiento");
        }
      });
      for (const [channel, stream] of [
        ["stdout", child.stdout],
        ["stderr", child.stderr],
      ] as const)
        stream.on("data", (chunk: Buffer) => {
          try {
            writer.push(step.id, channel, chunk);
          } catch {
            stop("Fallo al guardar logs");
          }
        });
      child.on("error", () => {
        reason = "No se pudo iniciar el ejecutable";
      });
      child.on("close", (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (killTimer) clearTimeout(killTimer);
        // No dejar procesos daemonizados por una receta antes de liberar el bloqueo.
        killGroup("SIGKILL");
        this.active = null;
        resolve({
          code,
          reason:
            reason ??
            (signal
              ? `Señal ${signal}`
              : code !== 0
                ? `Código de salida ${code}`
                : undefined),
        });
      });
    });
  }
  cleanup(now = Date.now()) {
    for (const job of this.db.all(
      "SELECT id FROM deployments WHERE ended<? AND status NOT IN ('pending','running')",
      now - this.config.retentionDays * 86400000,
    )) {
      removeLogs(path.join(this.config.dataDir, "logs"), job.id);
      this.db.run("DELETE FROM deployments WHERE id=?", job.id);
    }
    this.db.run(
      "DELETE FROM webhook_deliveries WHERE created<?",
      now - Math.max(30, this.config.retentionDays) * 86400000,
    );
    this.db.run("DELETE FROM sessions WHERE expires<?", now);
  }
  async close() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.active?.abort();
    while (this.busy) await new Promise((r) => setTimeout(r, 25));
  }
}
