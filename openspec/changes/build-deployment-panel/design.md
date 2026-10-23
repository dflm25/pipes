# Design

## Context

El directorio contiene únicamente OpenSpec y sus habilidades: no existen código, dependencias, pruebas ni decisiones técnicas previas que preservar. Ver proposal.md para la motivación. El usuario confirmó un servidor Linux compartido con las aplicaciones y despliegue exclusivamente manual en esta versión.

## Goals / Non-Goals

**Goals:** separar configuración, ejecución y consulta; mantener evidencia durable de cada intento; permitir recetas diferentes sin incrustar lógica de frameworks en el ejecutor.

**Non-Goals:** ejecutar código de usuarios no confiables, aislar aplicaciones como contenedores o garantizar recuperación transaccional de cambios de archivos y bases de datos.

## Decisions

### API Node.js y dashboard React con TypeScript

Por decisión del usuario, usar Node.js LTS y TypeScript para la API Fastify, y React con TypeScript para el dashboard. Tailwind CSS define estilos y estados visuales; React Hook Form gestiona formularios de acceso y alta/edición de proyectos, incluyendo errores por campo retornados por la API. La validación del cliente mejora la experiencia; la API vuelve a validar todos los datos y permisos.

Axios será el cliente HTTP centralizado con URL base relativa `/api`, envío del token CSRF en mutaciones y tratamiento consistente de errores de validación, sesión expirada y conflicto 409. Las mutaciones de despliegue no se reintentan automáticamente para evitar duplicar acciones. El seguimiento consulta estado y logs cada dos segundos, cancela solicitudes al desmontar la vista y evita consultas solapadas.

El dashboard se compila con Vite y sus archivos estáticos se sirven desde Fastify en el mismo origen que la API. En desarrollo, Vite redirige `/api` hacia Fastify. La cookie de sesión HttpOnly permanece gestionada por el navegador; no se guardan credenciales ni tokens de sesión en localStorage. La ruta de recuperación de la SPA no intercepta rutas `/api` ni oculta sus errores. React renderiza logs como texto, sin HTML sin sanitizar.

Se sustituye la propuesta inicial de plantillas HTML por el dashboard React solicitado. Servir cliente y API juntos mantiene un único despliegue y evita introducir CORS entre orígenes. Versiones compatibles de las dependencias se verificarán al implementar, antes de fijarlas en el lockfile.

### Persistencia local y un único trabajador

SQLite con migraciones versionadas almacena proyectos, sesiones, despliegues y pasos; logs estructurados viven en archivos privados fuera de los directorios desplegados. Entidades principales: Project (tipo, raíz real, ruta YAML); Deployment (proyecto, instantánea sin secretos, hash, estado, tiempos, motivo); DeploymentStep (orden, estado, resultado); Session. Retención configurable de treinta días para ejecuciones finalizadas.

Una transacción acepta el despliegue y reclama su bloqueo; índice único parcial por proyecto activo y prohibición de raíces solapadas impiden carreras. Un único trabajador procesa la cola persistente en orden, serializando también proyectos distintos para limitar consumo. No se introduce Redis ni un servicio de colas externo para este servidor único. Registrar referencias de comandos y variables, nunca valores secretos.

### YAML confiable, validado y congelado antes de ejecutar

El registro almacena nombre, tipo, raíz y ruta de archivo, inicialmente `deploy.yml`. Solo el operador edita YAML en disco; el panel edita metadatos y permite validar. Esquema estricto versión 1: `version`, `type`, `steps`; cada paso tiene `id`, `command`, `args`, `cwd` opcional relativo (por defecto `.`), `timeoutSeconds` opcional (600 por defecto; rango 1–3600), `env` opcional con valores `{ fromEnv: NOMBRE }`. `command` es un ejecutable, no una línea de shell; args es una lista de strings. El último paso debe llamarse `verify` para hacer explícita la comprobación final. YAML máximo 256 KiB, sin claves duplicadas, tags personalizados ni expansión de alias. El tipo debe coincidir con el registro.

Ejemplo ilustrativo para una aplicación Node.js existente y con repositorio ya clonado:

```yaml
version: 1
type: node
steps:
  - id: update
    command: git
    args: [pull, --ff-only, origin, main]
  - id: dependencies
    command: npm
    args: [ci]
  - id: build
    command: npm
    args: [run, build]
  - id: restart
    command: pm2
    args: [reload, example-app, --update-env]
  - id: verify
    command: curl
    args: [--fail, --silent, --show-error, http://127.0.0.1:3001/health]
    timeoutSeconds: 30
```

Las recetas son ejemplos adaptables, no detección automática. Laravel utiliza Composer y Artisan, con migraciones y mantenimiento indicados explícitamente; WordPress asume código personalizado versionado y preserva uploads, wp-config.php y base de datos; WP-CLI se usa solo en pasos elegidos. No usar `git reset --hard`, `git clean` ni sustitución completa del directorio por defecto. Rechazar YAML inválido antes de crear la ejecución. Congelar y guardar una instantánea ya validada impide que `git pull` cambie el procedimiento a mitad del despliegue. No registrar ni editar proyectos activos.

### Procesos locales y permisos

Usar procesos con ejecutable y argumentos separados, sin shell implícito, stdin cerrado, entorno base mínimo y solo secretos explícitamente referenciados. Resolver rutas reales contra raíces autorizadas por configuración del servicio; comprobar YAML y directorios al aceptar y antes de cada paso. Prohibir raíces solapadas incluso por symlinks. Esto evita errores de rutas pero no constituye sandbox: un comando confiable puede acceder a todo lo permitido al usuario Linux.

El servicio corre bajo un usuario dedicado, con permisos por grupo sobre proyectos. Reinicios privilegiados requieren reglas específicas del operador, nunca sudo general. Timeout termina el grupo con SIGTERM y luego SIGKILL a los cinco segundos. Ante error se omiten pasos posteriores; no hay rollback automático ni pasos ocultos de limpieza. Un fallo con mantenimiento activado requiere intervención y queda explicado en la receta.

Systemd administra la instancia única y su grupo de control (`KillMode=control-group`); un reinicio termina descendientes antes de iniciar otra instancia. Al arrancar, marcar trabajos anteriores pendientes o ejecutando como interrumpidos antes de aceptar solicitudes; bloquear recuperación si no puede asegurarse que los procesos anteriores terminaron. Documentar que lanzar instancias paralelas fuera de systemd no está soportado.

### Acceso y observabilidad

Administrador único configurado mediante herramienta local de bootstrap, contraseña con hash resistente y sesiones durables de ocho horas. Sin registro público. Limitar acceso a diez intentos por origen en quince minutos; sesiones HttpOnly, SameSite y Secure bajo HTTPS. Validar token CSRF en toda mutación, incluido cierre de sesión. Escuchar en localhost por defecto, servir mediante proxy HTTPS, configurar proxies confiables explícitamente.

API mínima: login/logout, listar/crear/editar proyectos, validar configuración, iniciar despliegue, listar historial, consultar despliegue y leer logs con cursor. Iniciar devuelve identificador; conflicto devuelve 409. El panel muestra inicio/fin/duración, pasos omitidos y causas específicas. Fechas persistidas en UTC y mostradas en zona del navegador.

Capturar stdout/stderr con canal y secuencia de recepción; no prometer orden temporal exacto entre canales. Aplicar ocultación incremental antes de escribir o transmitir, reteniendo sufijos suficientes para secretos partidos entre fragmentos por canal. Límite diez MiB por despliegue, marcador de truncamiento, seguir drenando salida para no bloquear procesos. No registrar entorno ni credenciales. El filtrado cubre valores exactos registrados, no secretos arbitrarios ni transformaciones emitidas por herramientas. Persistir resultado antes de devolverlo; un error de escritura detiene el proceso y bloquea una declaración de éxito. Limpiar archivos y metadatos vencidos sin tocar trabajos activos.

## Risks / Trade-offs

- [Despliegue en el directorio activo puede dejar una aplicación parcialmente actualizada] → documentar respaldo y recuperación manual; excluir rollback y cero interrupciones de esta versión.
- [YAML permite ejecutar código con permisos del servicio] → archivos editables solo por operadores confiables, sesión privada y usuario de permisos limitados.
- [Scripts de dependencias o comandos pueden alterar rutas o revelar datos] → revisar recetas y dependencias; el aislamiento de rutas no sustituye permisos Linux.
- [Cambios de base de datos pueden ser irreversibles] → pasos explícitos y respaldo previo según aplicación; no incluir migraciones destructivas en ejemplos.
- [Panel y aplicaciones comparten CPU/disco] → un trabajador, timeouts, captura limitada y retención.
- [Fallo total de disco impide persistir un estado final] → detener ejecución, informar indisponibilidad y recuperar como interrumpida al restablecer almacenamiento.

## Migration Plan

No hay datos existentes que migrar. Crear esquema inicial y directorio privado de datos; configurar administrador, raíces autorizadas y usuario de servicio. Instalar herramientas externas requeridas, proxy HTTPS y unidad systemd. Probar primero con aplicaciones de prueba para cada tipo, después registrar proyectos reales y adaptar recetas verificando respaldos y permisos. Para retirar la herramienta, detener el servicio y conservar copia de SQLite y logs; las aplicaciones siguen bajo sus gestores actuales. Un despliegue fallido se recupera manualmente mediante el procedimiento del proyecto.
