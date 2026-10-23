# Pipes

Panel privado de despliegues manuales y automáticos mediante webhooks de GitHub y GitLab para aplicaciones Node.js, Laravel y WordPress en el mismo servidor Linux. API Fastify y dashboard React, ambos con TypeScript; Tailwind CSS, Axios, React Hook Form y SQLite.

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

El build genera `dist/server` y `dist/client`. `npm start` sirve el dashboard compilado y la API desde el mismo origen. No hay registro público ni credenciales predeterminadas. Los endpoints `/api` requieren sesión salvo `/api/login` y los receptores de webhooks, que exigen firma HMAC (GitHub) o token secreto (GitLab); los desconocidos no devuelven el HTML de la SPA. Las sesiones expiran a las ocho horas.

## Uso

1. Crea `deploy.yml` en el directorio de tu aplicación; adapta una receta de `examples/` y revisa cada comando.
2. En el panel registra nombre, tipo, directorio absoluto y ruta relativa al YAML. El archivo y sus rutas deben ser accesibles y válidos.
3. Abre el proyecto, valida el YAML y pulsa **Desplegar ahora**.
4. Consulta los pasos, códigos de salida y logs. La configuración se congela al aceptar el despliegue, incluso si Git actualiza el YAML durante la ejecución.

Una ejecución activa por proyecto; todos los proyectos comparten un único trabajador en orden de llegada. Un doble clic informa conflicto. Un error detiene los pasos restantes; no existe rollback automático. Tras reiniciar el servicio, los trabajos anteriores se marcan interrumpidos y requieren inicio manual. No ejecutar dos instancias del servicio con los mismos datos.

Consulta [contrato YAML](docs/yaml.md), [instalación Linux](docs/linux.md) y [validación](docs/validation.md).


## Despliegue automático con GitHub Webhooks

Pipes recibe pushes en una URL propia para cada proyecto:

```text
POST https://pipes.tu-dominio.com/api/webhooks/github/ID_DEL_PROYECTO
```

La ruta aparece en el detalle del proyecto, en **WEBHOOK GITHUB**. No necesita una sesión del panel ni token CSRF: autentica cada entrega con `X-Hub-Signature-256` (HMAC-SHA256 sobre el cuerpo original), siguiendo la [documentación de GitHub](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).

### 1. Configura el proyecto

Agrega el bloque opcional `github` al `deploy.yml` existente, conservando tus pasos:

```yaml
version: 1
type: node # node, laravel o wordpress
github:
  repository: tu-usuario/tu-repositorio
  branch: main
  secretEnv: GITHUB_WEBHOOK_SECRET
steps:
  - id: update
    command: git
    args: [pull, --ff-only, origin, main]
  # Conserva aquí tus pasos de instalación, build y reinicio.
  - id: verify
    command: curl
    args: [--fail, --silent, --show-error, https://tu-app.com/health]
    timeoutSeconds: 30
```

El bloque `github` es opcional: sin él, el proyecto sigue funcionando manualmente y su receptor responde 404. La rama configurada filtra los eventos; **no cambia de rama ni reemplaza los comandos de tu receta**. Asegúrate de que el repositorio local, su rama y el paso de actualización coincidan con `repository` y `branch`. Se despliega lo que actualice la receta (normalmente la versión más reciente de la rama), no necesariamente el commit exacto del evento.

### 2. Configura un secreto

Genera un secreto aleatorio en tu terminal:

```sh
openssl rand -hex 32
```

Guarda el resultado en el `.env` de Pipes; en producción, en el archivo de entorno del servicio:

```env
GITHUB_WEBHOOK_SECRET=PEGA_AQUI_EL_SECRETO_GENERADO
```

El valor debe tener al menos 32 bytes. `secretEnv` contiene el **nombre** de la variable, nunca el secreto. Puedes usar variables distintas por proyecto. No subas `.env` a GitHub ni incluyas el secreto en la URL. Reinicia Pipes después de cambiar el entorno. El webhook no configura las credenciales Git: el usuario de servicio debe tener acceso al repositorio para ejecutar `git pull` sin pedir contraseña.

### 3. Crea el webhook en GitHub

En el repositorio, abre **Settings → Webhooks → Add webhook**:

- **Payload URL:** la URL HTTPS de Pipes con el ID de tu proyecto.
- **Content type:** `application/json`.
- **Secret:** exactamente el mismo valor que guardaste en el entorno de Pipes.
- **SSL verification:** habilitada.
- **Events:** `Just the push event`.
- **Active:** habilitado.

GitHub debe poder acceder a esa URL. Una dirección `localhost` o una IP privada no es accesible desde GitHub; utiliza el dominio público con proxy HTTPS del servidor. Para pruebas locales necesitarías exponer únicamente el receptor mediante un túnel HTTPS de tu elección. El límite del cuerpo es 1 MiB; configura el proxy para admitir ese tamaño.

### 4. Comprueba el funcionamiento

GitHub envía un `ping` al crear el webhook: Pipes responde `200` con `status: pong`. Después de un push a la rama configurada, responde `202` con `status: accepted` y el identificador del despliegue. La respuesta confirma la aceptación en cola, no el éxito del deploy. Consulta los pasos y logs en el panel: el historial indica **GitHub** como origen.

| Respuesta | Significado |
| --- | --- |
| `200 duplicate` | Entrega o cuerpo ya aceptado; devuelve el mismo ID sin ejecutar de nuevo. |
| `202 ignored` | Otra rama, eliminación de rama o evento diferente de push. |
| `400` | JSON, payload o identificador de entrega inválido. |
| `401` | Firma ausente, inválida o secreto diferente. |
| `403` | El repositorio no coincide con el configurado. |
| `404` | Proyecto inexistente o sin configuración `github`. |
| `409` | Ya hay un despliegue activo; no se acepta otro para el mismo proyecto. |
| `413` | Cuerpo superior a 1 MiB. |
| `503` | Configuración, secreto o ejecutor no disponible. |

La aceptación y el registro de entrega se guardan en una misma transacción SQLite. Se recuerdan tanto `X-GitHub-Delivery` como el hash del cuerpo por proyecto durante al menos treinta días (o el plazo de retención, si es mayor), incluso tras reiniciar Pipes. Una entrega rechazada por conflicto no se registra como aceptada y puede reenviarse cuando termine el despliegue activo.

Si algo falla, revisa **Settings → Webhooks → Recent Deliveries** en GitHub y el historial de Pipes. Para reenviar un evento que no fue aceptado, usa **Redeliver**; Pipes no reintenta despliegues automáticamente. Una entrega ya aceptada, incluso si su despliegue falló, no se vuelve a ejecutar al reenviarla: corrige la causa y utiliza el botón manual o genera un nuevo push. Para GitLab, consulta la configuración siguiente. Otros proveedores aún no están implementados.


## Despliegue automático con GitLab Webhooks

GitHub y GitLab tienen receptores independientes y comparten la cola, historial y logs:

```text
POST https://pipes.tu-dominio.com/api/webhooks/github/ID_DEL_PROYECTO
POST https://pipes.tu-dominio.com/api/webhooks/gitlab/ID_DEL_PROYECTO
```

La URL de GitLab también aparece en el detalle del proyecto. Funciona con GitLab.com y GitLab Self-Managed que envíen el formato estándar de Push Hook con token secreto. Se autentica mediante `X-Gitlab-Token`, según la [documentación de GitLab](https://docs.gitlab.com/user/project/integrations/webhooks/). Esta integración utiliza **Secret token**, no Signing token.

### 1. Configura el YAML y el entorno

En el `deploy.yml` agrega `gitlab`, manteniendo tus pasos existentes:

```yaml
version: 1
type: node
gitlab:
  repository: mi-grupo/mi-subgrupo/mi-aplicacion
  branch: main
  secretEnv: GITLAB_WEBHOOK_SECRET
steps:
  - id: update
    command: git
    args: [pull, --ff-only, origin, main]
  # Agrega tus pasos de instalación, build y reinicio aquí.
  - id: verify
    command: curl
    args: [--fail, --silent, --show-error, https://tu-app.com/health]
    timeoutSeconds: 30
```

`repository` es la ruta completa del proyecto en GitLab, **sin dominio ni sufijo .git**; admite subgrupos y debe coincidir exactamente con `project.path_with_namespace` del evento. Configura el secreto en el entorno del servicio:

```env
GITLAB_WEBHOOK_SECRET=PEGA_AQUI_UN_SECRETO_ALEATORIO
```

Genera el valor con `openssl rand -hex 32` (mínimo 32 bytes) y reinicia Pipes. Usa un secreto diferente por proyecto/proveedor, especialmente entre distintas instancias de GitLab. Sin bloque `gitlab`, su receptor responde 404. Puedes incluir tanto `github` como `gitlab` en el mismo YAML si necesitas ambos, con variables de secreto distintas. El repositorio local y el paso Git deben corresponder a la fuente que quieres desplegar: el webhook no cambia el remoto ni hace checkout del commit recibido.

### 2. Crea el webhook en GitLab

En tu proyecto abre **Settings → Webhooks → Add new webhook**:

- **URL:** la URL HTTPS `/api/webhooks/gitlab/ID_DEL_PROYECTO` de tu servidor.
- **Secret token:** el mismo valor de `GITLAB_WEBHOOK_SECRET`.
- **Trigger:** activa **Push events**; selecciona la rama deseada si GitLab ofrece ese filtro. Pipes también valida `branch`.
- **SSL verification:** habilitada.
- Deja el payload JSON estándar, sin plantilla personalizada ni transformaciones.

Guarda y usa **Test → Push events** para comprobarlo. **Esta prueba puede iniciar un despliegue real** si corresponde al proyecto y rama configurados. GitLab no envía un evento `ping` equivalente al de GitHub. Para una prueba que coincida con tu configuración puedes hacer un push a la rama elegida.

### 3. Resultados y reenvíos

Un push válido devuelve `202 accepted` con el ID del despliegue; el historial muestra **GitLab**. Otros eventos, tags, otra rama o eliminación de rama devuelven `202 ignored`. Un token ausente/incorrecto devuelve `401`; otro proyecto devuelve `403`; payload inválido devuelve `400`. Los estados `404`, `409`, `413` y `503` tienen el mismo significado explicado para GitHub.

Las entregas se identifican primero por `Idempotency-Key`, después por `X-Gitlab-Event-UUID` y, en versiones sin esos encabezados, por el hash del cuerpo. También se comprueba el hash para impedir duplicados al cambiar el ID. La deduplicación queda separada por proyecto **y proveedor**, persiste tras reinicios y conserva las entregas anteriores de GitHub mediante una migración automática SQLite.

Para diagnosticar, revisa las entregas del webhook en GitLab y los logs en Pipes. Un `409` requiere reenviar cuando termine la ejecución activa. Una entrega ya aceptada devuelve `200 duplicate`, incluso si su despliegue terminó fallido: corrige la causa y ejecuta manualmente o genera un nuevo push. No hay reintento automático del deploy. Es obligatorio usar HTTPS en producción porque el Secret token de GitLab se envía en el encabezado de cada solicitud.
