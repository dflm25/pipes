# Contrato deploy.yml, versión 1

Campos superiores obligatorios: `version: 1`, `type: node|laravel|wordpress` y `steps` (1–100 pasos). Se admite bloques opcionales `github` y `gitlab` con `repository`, `branch` y `secretEnv`; consulta el README para activar el webhook. El tipo debe coincidir con el proyecto. Claves desconocidas, duplicados, etiquetas y alias se rechazan. Tamaño máximo: 256 KiB.

Cada paso contiene:

| Campo | Contrato |
| --- | --- |
| `id` | Único, empieza por letra minúscula; letras, números o guiones; máximo 64 caracteres. El último paso se llama `verify`. |
| `command` | Ejecutable, no una línea de shell. Disponible en PATH o con ruta absoluta. |
| `args` | Lista obligatoria de argumentos de texto, incluso vacía. No se interpretan `$()`, redirecciones ni separadores. |
| `cwd` | Opcional, relativo al proyecto; por defecto `.`. Debe existir y resolver dentro del proyecto. |
| `timeoutSeconds` | Entero opcional entre 1 y 3600; por defecto 600. |
| `env` | Mapa opcional de variables con referencias `{ fromEnv: NOMBRE }`. No admite valores literales. |

```yaml
version: 1
type: node
steps:
  - id: verify
    command: node
    args: [scripts/healthcheck.js]
    timeoutSeconds: 30
    env:
      API_KEY:
        fromEnv: HEALTHCHECK_API_KEY
```

El operador configura `HEALTHCHECK_API_KEY` en el entorno del servicio. Nunca escribas secretos en argumentos ni en el YAML. Los valores referenciados se ocultan antes de escribir/transmitir logs, incluso partidos entre fragmentos por canal. No se pueden detectar secretos ajenos al entorno registrado ni sus transformaciones. La instantánea guarda referencias, no valores. Evita scripts que impriman credenciales.

Los comandos reciben PATH, LANG y las variables declaradas. Si una herramienta requiere HOME, PM2_HOME, SSH_AUTH_SOCK u otra variable, declárala mediante `fromEnv` y configúrala para el usuario de servicio. npm, Composer, PHP, Git, curl, WP-CLI y PM2 son herramientas externas según la receta, no se instalan desde el panel.

## Adaptar recetas

- Node.js: `examples/node.deploy.yml` asume lockfile, script build y PM2 externo ya configurado. La URL `/health` debe existir en la aplicación. PM2_HOME debe apuntar al mismo gestor de procesos; no iniciar daemons que pertenezcan al grupo del panel.
- Laravel: Composer y PHP accesibles; `.env`, storage y base de datos persisten. `artisan optimize` y `queue:restart` requieren permisos de escritura. Configura la URL real de salud. Si compilas frontend, agrega sus pasos explícitamente. Agrega `artisan migrate --force` únicamente con respaldo y revisión de migraciones.
- WordPress: la receta registra la raíz de un tema personalizado ya versionado y valida `functions.php`. No reemplaza toda la instalación, no actualiza núcleo/plugins ni base de datos. Para más pasos declara WP-CLI explícitamente con la ruta de instalación autorizada; verifica uploads y wp-config.php fuera del contenido versionado.

Los directorios registrados no pueden solaparse ni apuntar fuera de las raíces autorizadas mediante enlaces. No usar reset/clean destructivos por defecto. La receta debe ser propiedad de un operador confiable: es código con los permisos Linux del ejecutor, no un sandbox.

## Errores y recuperación

Un paso fallido, timeout, señal o problema al guardar logs detiene la secuencia. Los pasos posteriores quedan omitidos. El timeout envía SIGTERM al grupo y, tras cinco segundos, SIGKILL. Las recetas deben ejecutar procesos finitos; no dejar servidores persistentes como descendientes.

Si activas mantenimiento Laravel y falla un paso, los pasos de salida de mantenimiento no se ejecutarán automáticamente. Inspecciona logs, restaura código/datos según el respaldo y ejecuta `php artisan up` manualmente bajo el usuario del proyecto después de corregir la causa. Revisa compatibilidad entre código y esquema antes de reintentar. Para Node.js restaura una versión conocida y usa el gestor de procesos configurado; para WordPress restaura tema y, si fue afectada, la base de datos desde respaldo.
