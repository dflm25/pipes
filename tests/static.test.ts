import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
// Verifica el artefacto compilado, no el fallback de desarrollo.
test("dashboard compilado sirve navegación directa y API no devuelve HTML", async () => {
  const { createApp } = await import("../dist/server/app.js");
  const { loadConfig } = await import("../dist/server/config.js");
  const base = mkdtempSync(path.join(os.tmpdir(), "pipes-static-"));
  mkdirSync(path.join(base, "apps"));
  const { app } = await createApp(
    loadConfig({
      DEPLOY_ROOTS: path.join(base, "apps"),
      DATA_DIR: path.join(base, "data"),
    }),
  );
  try {
    const page = await app.inject({
      method: "GET",
      url: "/proyectos/demo",
      headers: { accept: "text/html" },
    });
    assert.equal(page.statusCode, 200);
    assert(page.body.includes('id="root"'));
    const unknown = await app.inject({
      method: "GET",
      url: "/api/unknown",
      headers: { accept: "text/html" },
    });
    assert.equal(unknown.statusCode, 401);
    assert(!unknown.body.includes("<!doctype"));
    assert.equal(
      (await app.inject({ method: "GET", url: "/assets/no-file.js" }))
        .statusCode,
      404,
    );
  } finally {
    await app.close();
    rmSync(base, { recursive: true });
  }
});
