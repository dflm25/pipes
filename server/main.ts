import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
const config = loadConfig();
if (config.production && process.getuid?.() === 0)
  throw new Error("El servicio no debe ejecutarse como root");
const { app } = await createApp(config);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close();
  });
await app.listen({ host: config.host, port: config.port });
console.log(`Pipes disponible en http://${config.host}:${config.port}`);
