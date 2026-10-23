import { loadConfig } from "./config.js";
import { Store } from "./db.js";
import { passwordHash } from "./auth.js";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
const config = loadConfig();
if (!stdin.isTTY)
  throw new Error("Ejecuta npm run admin desde un terminal interactivo");
const rl = createInterface({ input: stdin, output: stdout });
const username = (await rl.question("Administrador: ")).trim();
rl.close();
stdout.write("Contraseña (mínimo 12 caracteres, entrada oculta): ");
stdin.setRawMode(true);
stdin.resume();
const password = await new Promise<string>((resolve, reject) => {
  let value = "";
  const listener = (chunk: Buffer) => {
    for (const char of chunk.toString()) {
      if (char === "\u0003") {
        stdin.off("data", listener);
        reject(new Error("Cancelado"));
        return;
      }
      if (char === "\r" || char === "\n") {
        stdin.off("data", listener);
        resolve(value);
        return;
      }
      if (char === "\u007f") value = value.slice(0, -1);
      else value += char;
    }
  };
  stdin.on("data", listener);
}).finally(() => {
  stdin.setRawMode(false);
  stdin.pause();
  stdout.write("\n");
});
if (
  !username ||
  username.length > 100 ||
  password.length < 12 ||
  password.length > 256
)
  throw new Error("Credenciales inválidas");
const db = new Store(config.dataDir);
db.transaction(() => {
  db.run(
    "INSERT INTO admin(id,username,password) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,password=excluded.password",
    username,
    passwordHash(password),
  );
  db.run("DELETE FROM sessions");
});
db.close();
console.log("Administrador configurado; sesiones anteriores invalidadas.");
