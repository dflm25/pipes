import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { parseDocument, visit, isAlias } from "yaml";
import { z } from "zod";
import { within } from "./config.js";
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}
const stepSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    command: z
      .string()
      .min(1)
      .max(1024)
      .refine((s) => !s.includes("\0")),
    args: z
      .array(
        z
          .string()
          .max(16384)
          .refine((s) => !s.includes("\0")),
      )
      .max(256),
    cwd: z.string().default("."),
    timeoutSeconds: z.number().int().min(1).max(3600).default(600),
    env: z
      .record(
        z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
        z
          .object({ fromEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/) })
          .strict(),
      )
      .default({}),
  })
  .strict();
export const recipeSchema = z
  .object({
    version: z.literal(1),
    type: z.enum(["node", "laravel", "wordpress"]),
    steps: z.array(stepSchema).min(1).max(100),
  })
  .strict()
  .superRefine((v, c) => {
    if (new Set(v.steps.map((s) => s.id)).size !== v.steps.length)
      c.addIssue({
        code: "custom",
        message: "Los identificadores de pasos deben ser únicos",
        path: ["steps"],
      });
    if (v.steps.at(-1)?.id !== "verify")
      c.addIssue({
        code: "custom",
        message: "El último paso debe llamarse verify",
        path: ["steps"],
      });
  });
export type Recipe = z.infer<typeof recipeSchema>;
export const projectSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    type: z.enum(["node", "laravel", "wordpress"]),
    root: z.string().min(1),
    yaml: z.string().min(1).default("deploy.yml"),
  })
  .strict();
export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new ApiError(
      400,
      "Revisa los campos indicados",
      Object.fromEntries(
        result.error.issues.map((i) => [i.path.join("."), i.message]),
      ),
    );
  return result.data;
}
export function localPath(
  root: string,
  relative: string,
  directory = false,
): string {
  if (path.isAbsolute(relative))
    throw new ApiError(400, "La ruta debe ser relativa al proyecto");
  let actual: string;
  try {
    actual = realpathSync(path.resolve(root, relative));
  } catch {
    throw new ApiError(400, "La ruta configurada no existe o no es accesible");
  }
  if (!within(root, actual))
    throw new ApiError(400, "La ruta sale del proyecto");
  if (directory ? !statSync(actual).isDirectory() : !statSync(actual).isFile())
    throw new ApiError(400, "Tipo de ruta inválido");
  return actual;
}
export function readRecipe(
  root: string,
  yaml: string,
  type: string,
  env = process.env,
): Recipe {
  const file = localPath(root, yaml);
  if (statSync(file).size > 256 * 1024)
    throw new ApiError(400, "YAML supera 256 KiB");
  const text = readFileSync(file, "utf8");
  const doc = parseDocument(text, { uniqueKeys: true, customTags: [] });
  if (doc.errors.length || doc.warnings.length)
    throw new ApiError(
      400,
      "YAML inválido: revisa sintaxis, claves duplicadas y etiquetas",
    );
  visit(doc, (_, node) => {
    if (isAlias(node)) throw new ApiError(400, "No se permiten alias YAML");
  });
  const parsed = recipeSchema.safeParse(doc.toJS({ maxAliasCount: 0 }));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ApiError(
      400,
      `YAML ${issue.path.join(".") || "raíz"}: ${issue.message}`,
    );
  }
  const recipe = parsed.data;
  if (recipe.type !== type)
    throw new ApiError(400, "El tipo YAML no coincide con el proyecto");
  for (const step of recipe.steps) {
    localPath(root, step.cwd, true);
    for (const ref of Object.values(step.env))
      if (!env[ref.fromEnv])
        throw new ApiError(400, `Variable no disponible: ${ref.fromEnv}`);
  }
  return recipe;
}
