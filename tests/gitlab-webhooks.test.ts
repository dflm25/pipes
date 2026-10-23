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
import { Store } from "../server/db.js";

async function fixture() {
  const base = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "pipes-gitlab-")),
  );
  const root = path.join(base, "apps", "demo");
  mkdirSync(root, { recursive: true });
  const secret = "gitlab-test-token-with-at-least-32-bytes";
  process.env.PIPES_GITLAB_TEST_SECRET = secret;
  const recipe = {
    version: 1,
    type: "node",
    gitlab: {
      repository: "group/subgroup/repo",
      branch: "main",
      secretEnv: "PIPES_GITLAB_TEST_SECRET",
    },
    github: {
      repository: "owner/repo",
      branch: "main",
      secretEnv: "PIPES_GITLAB_TEST_SECRET",
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
  const payload = {
    object_kind: "push",
    project: { path_with_namespace: "group/subgroup/repo" },
    ref: "refs/heads/main",
    after: "a".repeat(40),
  };
  const send = (
    body: unknown = payload,
    headers: Record<string, string> = {},
    raw?: string,
  ) =>
    service.app.inject({
      method: "POST",
      url: "/api/webhooks/gitlab/test",
      headers: {
        "content-type": "application/json",
        "x-gitlab-event": "Push Hook",
        "x-gitlab-token": secret,
        "idempotency-key": "delivery-1",
        ...headers,
      },
      payload: raw ?? JSON.stringify(body),
    });
  return {
    ...service,
    config,
    base,
    root,
    recipe,
    payload,
    secret,
    send,
    close: async () => {
      await service.app.close();
      delete process.env.PIPES_GITLAB_TEST_SECRET;
      rmSync(base, { recursive: true });
    },
  };
}
const idle = async (runner: { busy: boolean }) => {
  const deadline = Date.now() + 5000;
  while (runner.busy) {
    if (Date.now() > deadline) throw Error("Timeout esperando trabajador");
    await new Promise((r) => setTimeout(r, 10));
  }
};

test("GitLab autentica token, valida payload y no omite autenticación de otras rutas", async () => {
  const f = await fixture();
  try {
    for (const token of ["", "incorrect", f.secret.slice(1)])
      assert.equal(
        (await f.send(f.payload, { "x-gitlab-token": token })).statusCode,
        401,
      );
    assert.equal((await f.send(f.payload, {}, "{invalid")).statusCode, 400);
    assert.equal(
      (await f.send(f.payload, { "idempotency-key": "invalid id" })).statusCode,
      400,
    );
    assert.equal((await f.send({ object_kind: "push" })).statusCode, 400);
    assert.equal(
      (await f.app.inject({ method: "POST", url: "/api/projects/test/deploy" }))
        .statusCode,
      401,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/webhooks/gitlab/test/extra",
        })
      ).statusCode,
      401,
    );
    const accepted = await f.send();
    assert.equal(accepted.statusCode, 202, accepted.body);
    assert.equal(
      f.db.get("SELECT origin FROM deployments WHERE id=?", accepted.json().id)!
        .origin,
      "gitlab",
    );
  } finally {
    await f.close();
  }
});
test("GitLab filtra subgrupo, rama, tags, eventos y eliminación de rama", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (
        await f.send({
          ...f.payload,
          project: { path_with_namespace: "other/subgroup/repo" },
        })
      ).statusCode,
      403,
    );
    for (const body of [
      { ...f.payload, ref: "refs/heads/develop" },
      { ...f.payload, ref: "refs/tags/v1" },
      { ...f.payload, after: "0".repeat(40) },
    ])
      assert.equal((await f.send(body)).json().status, "ignored");
    assert.equal(
      (await f.send(f.payload, { "x-gitlab-event": "Tag Push Hook" })).json()
        .status,
      "ignored",
    );
    assert.equal(
      (await f.send({ ...f.payload, object_kind: "tag_push" })).statusCode,
      400,
    );
    assert.equal(f.db.get("SELECT COUNT(*) n FROM deployments")!.n, 0);
  } finally {
    await f.close();
  }
});
test("GitLab deduplica, permite reintentar conflictos y separa proveedores", async () => {
  const f = await fixture();
  try {
    const first = await f.send();
    assert.equal(first.statusCode, 202);
    assert.equal((await f.send()).json().id, first.json().id);
    assert.equal(
      (
        await f.send(f.payload, { "idempotency-key": "another-delivery" })
      ).json().status,
      "duplicate",
    );
    const next = { ...f.payload, after: "b".repeat(40) };
    assert.equal(
      (await f.send(next, { "idempotency-key": "delivery-2" })).statusCode,
      409,
    );
    await idle(f.runner);
    assert.equal(
      (await f.send(next, { "idempotency-key": "delivery-2" })).statusCode,
      202,
    );
    await idle(f.runner);
    const github = JSON.stringify({
      repository: { full_name: "owner/repo" },
      ref: "refs/heads/main",
      deleted: false,
      after: "a".repeat(40),
    });
    const gh = await f.app.inject({
      method: "POST",
      url: "/api/webhooks/github/test",
      headers: {
        "content-type": "application/json",
        "x-github-event": "push",
        "x-github-delivery": "delivery-1",
        "x-hub-signature-256": `sha256=${createHmac("sha256", f.secret).update(github).digest("hex")}`,
      },
      payload: github,
    });
    assert.equal(gh.statusCode, 202, gh.body);
    await idle(f.runner);
    assert.deepEqual(
      f.db
        .all("SELECT DISTINCT origin FROM deployments ORDER BY origin")
        .map((x) => x.origin),
      ["github", "gitlab"],
    );
    await f.app.close();
    const reopened = await createApp(f.config);
    try {
      const duplicate = await reopened.app.inject({
        method: "POST",
        url: "/api/webhooks/gitlab/test",
        headers: {
          "content-type": "application/json",
          "x-gitlab-event": "Push Hook",
          "x-gitlab-token": f.secret,
          "idempotency-key": "delivery-1",
        },
        payload: JSON.stringify(f.payload),
      });
      assert.equal(duplicate.json().status, "duplicate");
      assert.equal(duplicate.json().id, first.json().id);
    } finally {
      await reopened.app.close();
    }
  } finally {
    await f.close();
  }
});
test("GitLab admite Event-UUID y versiones sin ID, bloquea configuración deshabilitada y cuerpos grandes", async () => {
  const f = await fixture();
  try {
    const raw = JSON.stringify(f.payload);
    const legacy = await f.app.inject({
      method: "POST",
      url: "/api/webhooks/gitlab/test",
      headers: {
        "content-type": "application/json",
        "x-gitlab-event": "Push Hook",
        "x-gitlab-token": f.secret,
        "x-gitlab-event-uuid": "old-event-uuid",
      },
      payload: raw,
    });
    assert.equal(legacy.statusCode, 202);
    assert.equal(
      f.db.get(
        "SELECT delivery FROM webhook_deliveries WHERE provider='gitlab'",
      )!.delivery,
      "old-event-uuid",
    );
    await idle(f.runner);
    const noID = await f.app.inject({
      method: "POST",
      url: "/api/webhooks/gitlab/test",
      headers: {
        "content-type": "application/json",
        "x-gitlab-event": "Push Hook",
        "x-gitlab-token": f.secret,
      },
      payload: JSON.stringify({ ...f.payload, after: "c".repeat(40) }),
    });
    assert.equal(noID.statusCode, 202);
    await idle(f.runner);
    const disabled = { ...f.recipe };
    delete (disabled as any).gitlab;
    writeFileSync(path.join(f.root, "deploy.yml"), JSON.stringify(disabled));
    assert.equal((await f.send()).statusCode, 404);
    writeFileSync(path.join(f.root, "deploy.yml"), JSON.stringify(f.recipe));
    delete process.env.PIPES_GITLAB_TEST_SECRET;
    assert.equal((await f.send()).statusCode, 503);
    process.env.PIPES_GITLAB_TEST_SECRET = "short";
    assert.equal((await f.send()).statusCode, 503);
    process.env.PIPES_GITLAB_TEST_SECRET = f.secret;
    assert.equal(
      (await f.send(f.payload, {}, "x".repeat(1024 * 1024 + 1))).statusCode,
      413,
    );
  } finally {
    await f.close();
  }
});
test("migración v2 conserva registros existentes de GitHub", async () => {
  const f = await fixture();
  try {
    await f.app.close();
    let store = new Store(f.config.dataDir);
    store.db.exec(
      `DROP TABLE webhook_deliveries; CREATE TABLE webhook_deliveries(projectId TEXT NOT NULL,delivery TEXT NOT NULL,payloadHash TEXT NOT NULL,deploymentId TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(projectId,delivery),UNIQUE(projectId,payloadHash)); PRAGMA user_version=2;`,
    );
    store.run(
      "INSERT INTO webhook_deliveries VALUES(?,?,?,?,?)",
      "test",
      "old-delivery",
      "old-hash",
      "old-deployment",
      Date.now(),
    );
    store.close();
    store = new Store(f.config.dataDir);
    try {
      const old = store.get("SELECT * FROM webhook_deliveries")!;
      assert.equal(old.provider, "github");
      assert.equal(old.delivery, "old-delivery");
      assert.equal(old.deploymentId, "old-deployment");
      assert.equal(store.get("PRAGMA user_version")!.user_version, 3);
      assert.equal(
        store.get("SELECT name FROM projects WHERE id=?", "test")!.name,
        "Demo",
      );
    } finally {
      store.close();
    }
  } finally {
    await f.close();
  }
});
