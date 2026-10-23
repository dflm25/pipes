# Pipes

Panel privado de despliegues manuales para aplicaciones Node.js, Laravel y WordPress en el mismo servidor Linux. API Fastify y dashboard React, ambos con TypeScript; Tailwind CSS, Axios, React Hook Form y SQLite.

## Desarrollo

Requiere Node.js 24 o superior y npm. Los proyectos deben existir en disco, con sus repositorios ya clonados.

```sh
npm ci
cp .env.example .env
```

Edita `.env`: `DEPLOY_ROOTS` debe apuntar a uno o varios directorios existentes, separados por coma. `DATA_DIR` debe quedar fuera de esas raíces (también sin solapamiento). Configura el administrador desde un terminal; la contraseña se solicita oculta y requiere al menos doce caracteres:

```sh
npm run admin
npm run dev
```

API en `http://127.0.0.1:3400`, dashboard en la URL que imprime Vite. Vite redirige `/api` al puerto 3400; si cambias ese puerto, ajusta `vite.config.ts`. Ambos procesos leen `.env`. Para restablecer credenciales, vuelve a ejecutar `npm run admin`: reemplaza el administrador y revoca todas las sesiones.

```sh
npm run lint
npm test
npm run build
npm start
```

El build genera `dist/server` y `dist/client`. `npm start` sirve el dashboard compilado y la API desde el mismo origen. No hay registro público ni credenciales predeterminadas. Los endpoints `/api` siempre requieren sesión salvo `/api/login`; los desconocidos no devuelven el HTML de la SPA. Las sesiones expiran a las ocho horas.

## Uso

1. Crea `deploy.yml` en el directorio de tu aplicación; adapta una receta de `examples/` y revisa cada comando.
2. En el panel registra nombre, tipo, directorio absoluto y ruta relativa al YAML. El archivo y sus rutas deben ser accesibles y válidos.
3. Abre el proyecto, valida el YAML y pulsa **Desplegar ahora**.
4. Consulta los pasos, códigos de salida y logs. La configuración se congela al aceptar el despliegue, incluso si Git actualiza el YAML durante la ejecución.

Una ejecución activa por proyecto; todos los proyectos comparten un único trabajador en orden de llegada. Un doble clic informa conflicto. Un error detiene los pasos restantes; no existe rollback automático. Tras reiniciar el servicio, los trabajos anteriores se marcan interrumpidos y requieren inicio manual. No ejecutar dos instancias del servicio con los mismos datos.

Consulta [contrato YAML](docs/yaml.md), [instalación Linux](docs/linux.md) y [validación](docs/validation.md).
