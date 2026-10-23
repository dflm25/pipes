import type { FastifyInstance } from "fastify";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Store } from "./db.js";
import type { Runner } from "./runner.js";
import { ApiError, readRecipe } from "./yaml.js";

declare module "fastify" {
  interface FastifyContextConfig {
    webhookReceiver?: boolean;
  }
}

export async function registerWebhooks(
  app: FastifyInstance,
  db: Store,
  runner: Runner,
) {
  await app.register(async (scope) => {
    // Solo esta ruta recibe bytes sin modificar; los formularios conservan el parser JSON normal.
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_request, body, done) => done(null, body),
    );
    scope.post(
      "/api/webhooks/github/:projectId",
      { config: { webhookReceiver: true }, bodyLimit: 1024 * 1024 },
      async (request, reply) => {
        const { projectId } = request.params as { projectId: string };
        const project = db.get("SELECT * FROM projects WHERE id=?", projectId);
        if (!project) throw new ApiError(404, "Webhook no disponible");
        let github;
        try {
          runner.validateRoot(project);
          github = readRecipe(project.root, project.yaml, project.type).github;
        } catch {
          throw new ApiError(503, "Configuración del webhook no disponible");
        }
        if (!github) throw new ApiError(404, "Webhook no disponible");
        const secret = process.env[github.secretEnv];
        if (!secret || Buffer.byteLength(secret) < 32)
          throw new ApiError(503, "Configuración del webhook no disponible");
        const signature = request.headers["x-hub-signature-256"];
        if (
          !Buffer.isBuffer(request.body) ||
          typeof signature !== "string" ||
          !/^sha256=[a-fA-F0-9]{64}$/.test(signature)
        )
          throw new ApiError(401, "Firma del webhook inválida");
        const expected = createHmac("sha256", secret)
          .update(request.body)
          .digest();
        if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex")))
          throw new ApiError(401, "Firma del webhook inválida");
        const delivery = request.headers["x-github-delivery"];
        if (
          typeof delivery !== "string" ||
          !/^[A-Za-z0-9-]{1,128}$/.test(delivery)
        )
          throw new ApiError(400, "X-GitHub-Delivery inválido");
        let body: unknown;
        try {
          body = JSON.parse(request.body.toString("utf8"));
        } catch {
          throw new ApiError(400, "JSON inválido");
        }
        const repo = z
          .object({ repository: z.object({ full_name: z.string() }) })
          .safeParse(body);
        if (!repo.success)
          throw new ApiError(400, "Payload de GitHub inválido");
        if (
          repo.data.repository.full_name.toLowerCase() !==
          github.repository.toLowerCase()
        )
          throw new ApiError(403, "Repositorio no autorizado");
        const event = request.headers["x-github-event"];
        if (event === "ping") return { status: "pong" };
        if (event !== "push") {
          reply.code(202);
          return { status: "ignored", reason: "Evento distinto de push" };
        }
        const push = z
          .object({
            ref: z.string(),
            deleted: z.boolean(),
            after: z.string().regex(/^[a-fA-F0-9]{40,64}$/),
          })
          .safeParse(body);
        if (!push.success) throw new ApiError(400, "Payload push inválido");
        if (
          push.data.deleted ||
          /^0+$/.test(push.data.after) ||
          push.data.ref !== `refs/heads/${github.branch}`
        ) {
          reply.code(202);
          return {
            status: "ignored",
            reason: "Rama no configurada o eliminada",
          };
        }
        const payloadHash = createHash("sha256")
          .update(request.body)
          .digest("hex");
        const previous = db.get(
          "SELECT deploymentId FROM webhook_deliveries WHERE provider='github' AND projectId=? AND (delivery=? OR payloadHash=?)",
          projectId,
          delivery,
          payloadHash,
        );
        if (previous) return { status: "duplicate", id: previous.deploymentId };
        const id = runner.accept(project, { delivery, payloadHash });
        reply.code(202);
        return { status: "accepted", id };
      },
    );
    scope.post(
      "/api/webhooks/gitlab/:projectId",
      { config: { webhookReceiver: true }, bodyLimit: 1024 * 1024 },
      async (request, reply) => {
        const { projectId } = request.params as { projectId: string };
        const project = db.get("SELECT * FROM projects WHERE id=?", projectId);
        if (!project) throw new ApiError(404, "Webhook no disponible");
        let gitlab;
        try {
          runner.validateRoot(project);
          gitlab = readRecipe(project.root, project.yaml, project.type).gitlab;
        } catch {
          throw new ApiError(503, "Configuración del webhook no disponible");
        }
        if (!gitlab) throw new ApiError(404, "Webhook no disponible");
        const secret = process.env[gitlab.secretEnv];
        if (!secret || Buffer.byteLength(secret) < 32)
          throw new ApiError(503, "Configuración del webhook no disponible");
        const supplied = request.headers["x-gitlab-token"];
        // Comparar hashes de longitud fija evita comparar tokens con == o revelar su longitud.
        if (
          typeof supplied !== "string" ||
          !timingSafeEqual(
            createHash("sha256").update(supplied).digest(),
            createHash("sha256").update(secret).digest(),
          )
        )
          throw new ApiError(401, "Token del webhook inválido");
        if (!Buffer.isBuffer(request.body))
          throw new ApiError(400, "Se requiere application/json");
        let body: unknown;
        try {
          body = JSON.parse(request.body.toString("utf8"));
        } catch {
          throw new ApiError(400, "JSON inválido");
        }
        const repo = z
          .object({ project: z.object({ path_with_namespace: z.string() }) })
          .safeParse(body);
        if (!repo.success)
          throw new ApiError(400, "Payload de GitLab inválido");
        if (repo.data.project.path_with_namespace !== gitlab.repository)
          throw new ApiError(403, "Repositorio no autorizado");
        if (request.headers["x-gitlab-event"] !== "Push Hook") {
          reply.code(202);
          return { status: "ignored", reason: "Evento distinto de push" };
        }
        const push = z
          .object({
            object_kind: z.literal("push"),
            ref: z.string(),
            after: z.string().regex(/^[a-fA-F0-9]{40,64}$/),
          })
          .safeParse(body);
        if (!push.success) throw new ApiError(400, "Payload push inválido");
        if (
          /^0+$/.test(push.data.after) ||
          push.data.ref !== `refs/heads/${gitlab.branch}`
        ) {
          reply.code(202);
          return {
            status: "ignored",
            reason: "Rama no configurada o eliminada",
          };
        }
        const payloadHash = createHash("sha256")
          .update(request.body)
          .digest("hex");
        // Idempotency-Key permanece estable al reenviar. Versiones anteriores usan Event-UUID.
        const delivery =
          request.headers["idempotency-key"] ??
          request.headers["x-gitlab-event-uuid"] ??
          payloadHash;
        if (
          typeof delivery !== "string" ||
          !/^[A-Za-z0-9-]{1,128}$/.test(delivery)
        )
          throw new ApiError(
            400,
            "Identificador de entrega de GitLab inválido",
          );
        const previous = db.get(
          "SELECT deploymentId FROM webhook_deliveries WHERE provider='gitlab' AND projectId=? AND (delivery=? OR payloadHash=?)",
          projectId,
          delivery,
          payloadHash,
        );
        if (previous) return { status: "duplicate", id: previous.deploymentId };
        const id = runner.accept(project, {
          provider: "gitlab",
          delivery,
          payloadHash,
        });
        reply.code(202);
        return { status: "accepted", id };
      },
    );
  });
}
