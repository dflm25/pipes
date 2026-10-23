import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHmac } from "node:crypto";
import { createApp } from "../server/app.js";
import { loadConfig } from "../server/config.js";

async function fixture() {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pipes-hook-")));
  const root = path.join(base, "apps", "demo");
  mkdirSync(root, { recursive: true });
  const secret = "test-only-secret-with-at-least-32-bytes";
  process.env.PIPES_TEST_WEBHOOK_SECRET = secret;
  const recipe = {
    version: 1,
    type: "node",
    github: {
      repository: "owner/repo",
      branch: "main",
      secretEnv: "PIPES_TEST_WEBHOOK_SECRET",
    },
    steps: [
      {
        id: "verify",
        command: process.execPath,
        args: ["-e", 'setTimeout(()=>console.log("ok"),100)'],
      },
    ],
  };
  writeFileSync(path.join(root, "deploy.yml"), JSON.stringify(recipe));
  const config = loadConfig({
    DEPLOY_ROOTS: path.join(base, "apps"),
    DATA_DIR: path.join(base, "data"),
  });
  const service = await createApp(config);
  service.db.run(
    "INSERT INTO projects VALUES(?,?,?,?,?,?)",
    "test",
    "Demo",
    "node",
    root,
    "deploy.yml",
    Date.now(),
  );
  const send = (
    body: unknown,
    headers: Record<string, string> = {},
    raw?: string,
  ) => {
    const payload = raw ?? JSON.stringify(body);
    return service.app.inject({
      method: "POST",
      url: "/api/webhooks/github/test",
      headers: {
        "content-type": "application/json",
        "x-github-event": "push",
        "x-github-delivery": "delivery-1",
        "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`,
        ...headers,
      },
      payload,
    });
  };
  const payload = {
    repository: { full_name: "owner/repo" },
    ref: "refs/heads/main",
    deleted: false,
    after: "a".repeat(40),
  };
  return {
    ...service,
    config,
    base,
    root,
    recipe,
    payload,
    send,
    close: async () => {
      await service.app.close();
      delete process.env.PIPES_TEST_WEBHOOK_SECRET;
      rmSync(base, { recursive: true });
    },
  };
}
test("webhook autentica bytes originales y mantiene privadas las demás rutas", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await f.send(f.payload, { "x-hub-signature-256": "" })).statusCode,
      401,
    );
    assert.equal(
      (
        await f.send(f.payload, {
          "x-hub-signature-256": "sha256=" + "0".repeat(64),
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (await f.send(f.payload, { "x-hub-signature-256": "sha256=invalid" }))
        .statusCode,
      401,
    );
    assert.equal(
      (await f.send(f.payload, { "x-github-delivery": "" })).statusCode,
      400,
    );
    assert.equal((await f.send(f.payload, {}, "{invalid")).statusCode, 400);
    assert.equal(
      (await f.app.inject({ method: "POST", url: "/api/projects/test/deploy" }))
        .statusCode,
      401,
    );
    const raw = JSON.stringify(f.payload, null, 2) + "\n";
    const r = await f.send(f.payload, {}, raw);
    assert.equal(r.statusCode, 202, r.body);
    assert.equal(
      f.db.get("SELECT origin FROM deployments WHERE id=?", r.json().id)!
        .origin,
      "github",
    );
    const changed = await f.send(f.payload, {
      "x-hub-signature-256": `sha256=${createHmac("sha256", process.env.PIPES_TEST_WEBHOOK_SECRET!).update(raw).digest("hex")}`,
    });
    assert.equal(changed.statusCode, 401);
  } finally {
    await f.close();
  }
});
test("filtra repositorio, rama, eliminaciones y eventos; responde ping", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await f.send({ ...f.payload, repository: { full_name: "other/repo" } }))
        .statusCode,
      403,
    );
    assert.equal(
      (await f.send(f.payload, { "x-github-event": "ping" })).json().status,
      "pong",
    );
    for (const p of [
      { ...f.payload, ref: "refs/heads/develop" },
      { ...f.payload, ref: "refs/tags/v1" },
      { ...f.payload, deleted: true },
      { ...f.payload, after: "0".repeat(40) },
    ])
      assert.equal((await f.send(p)).json().status, "ignored");
    assert.equal(
      (await f.send(f.payload, { "x-github-event": "issues" })).json().status,
      "ignored",
    );
    assert.equal(
      (await f.send({ repository: { full_name: "owner/repo" } })).statusCode,
      400,
    );
    assert.equal(f.db.get("SELECT COUNT(*) n FROM deployments")!.n, 0);
    assert.equal(
      (await f.send({ ...f.payload, repository: { full_name: "OWNER/REPO" } }))
        .statusCode,
      202,
    );
  } finally {
    await f.close();
  }
});
test("deduplicación durable y conflicto no consume entrega rechazada", async () => {
  const f = await fixture();
  try {
    const first = await f.send(f.payload);
    assert.equal(first.statusCode, 202);
    const same = await f.send(f.payload);
    assert.equal(same.statusCode, 200);
    assert.equal(same.json().status, "duplicate");
    assert.equal(same.json().id, first.json().id);
    assert.equal(
      (
        await f.send(f.payload, { "x-github-delivery": "changed-header" })
      ).json().status,
      "duplicate",
    );
    const next = { ...f.payload, after: "b".repeat(40) };
    assert.equal(
      (await f.send(next, { "x-github-delivery": "delivery-2" })).statusCode,
      409,
    );
    assert.equal(f.db.get("SELECT COUNT(*) n FROM webhook_deliveries")!.n, 1);
    while (f.runner.busy) await new Promise((r) => setTimeout(r, 10));
    const accepted = await f.send(next, { "x-github-delivery": "delivery-2" });
    assert.equal(accepted.statusCode, 202);
    while (f.runner.busy) await new Promise((r) => setTimeout(r, 10));
    await f.app.close();
    const reopened = await createApp(f.config);
    try {
      const payload = JSON.stringify(f.payload);
      const r = await reopened.app.inject({
        method: "POST",
        url: "/api/webhooks/github/test",
        headers: {
          "content-type": "application/json",
          "x-github-event": "push",
          "x-github-delivery": "delivery-1",
          "x-hub-signature-256": `sha256=${createHmac("sha256", process.env.PIPES_TEST_WEBHOOK_SECRET!).update(payload).digest("hex")}`,
        },
        payload,
      });
      assert.equal(r.json().status, "duplicate");
      assert.equal(reopened.db.get("SELECT COUNT(*) n FROM deployments")!.n, 2);
    } finally {
      await reopened.app.close();
    }
  } finally {
    await f.close();
  }
});
test("webhook opcional, secreto requerido y cuerpo acotado", async () => {
  const f = await fixture();
  try {
    const without = { ...f.recipe };
    delete (without as any).github;
    writeFileSync(path.join(f.root, "deploy.yml"), JSON.stringify(without));
    assert.equal((await f.send(f.payload)).statusCode, 404);
    writeFileSync(path.join(f.root, "deploy.yml"), JSON.stringify(f.recipe));
    delete process.env.PIPES_TEST_WEBHOOK_SECRET;
    assert.equal((await f.send(f.payload)).statusCode, 503);
    process.env.PIPES_TEST_WEBHOOK_SECRET = "short";
    assert.equal((await f.send(f.payload)).statusCode, 503);
    process.env.PIPES_TEST_WEBHOOK_SECRET =
      "test-only-secret-with-at-least-32-bytes";
    assert.equal(
      (await f.send(f.payload, {}, "x".repeat(1024 * 1024 + 1))).statusCode,
      413,
    );
    assert.equal(f.db.get("SELECT COUNT(*) n FROM deployments")!.n, 0);
  } finally {
    await f.close();
  }
});
