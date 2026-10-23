# Tasks

## 1. Base de aplicación y persistencia

- [x] 1.1 Crear API Node.js/TypeScript con Fastify y dashboard React/TypeScript con Vite, Tailwind CSS, Axios y React Hook Form; configurar scripts de desarrollo, build, lint y pruebas y verificar instalación reproducible y compilación de cliente y servidor.
- [x] 1.2 Implementar configuración de servicio (raíces, datos, puerto, retención) y validación al arrancar; probar rechazo de raíces inexistentes y configuración inválida, y documentar variables en .env.example sin secretos.
- [x] 1.3 Crear migraciones SQLite para proyectos, ejecuciones, pasos y sesiones con bloqueo único de ejecución activa; probar migración inicial, reapertura y solicitudes concurrentes.

- [x] 1.4 Servir el dashboard compilado desde Fastify y configurar proxy /api en desarrollo y cliente Axios central con CSRF, errores y cancelación; probar navegación directa, errores API sin fallback HTML y que POST de despliegue no se reintenta, y documentar ambos modos de ejecución.

## 2. Acceso privado

- [x] 2.1 Implementar bootstrap local de administrador, hash de contraseña, login/logout y sesiones de ocho horas; probar credenciales inválidas, expiración, cierre e inaccesibilidad de endpoints privados.
- [x] 2.2 Aplicar CSRF, cookies de producción, límite de diez intentos por quince minutos y configuración explícita de proxy; probar rechazo de peticiones cruzadas y limitación con reloj controlado.
- [x] 2.3 Crear pantalla de acceso en React/TypeScript con Tailwind, React Hook Form y Axios y documentación de bootstrap/recuperación de contraseña; verificar validación, errores de credenciales y sesión expirada en navegador sin credenciales predeterminadas.

## 3. Proyectos y contrato YAML

- [x] 3.1 Implementar esquema versión 1, parseo limitado, paso final verify, defaults, referencias fromEnv y errores por campo; probar YAML inválido, claves duplicadas/desconocidas, alias, tamaño excesivo y secretos ausentes.
- [x] 3.2 Implementar registro, listado, edición y validación de proyectos con realpath y raíces autorizadas; probar escapes por symlinks, rutas solapadas, tipo incompatible y edición bloqueada durante ejecución activa.
- [x] 3.3 Crear formulario con React Hook Form y vistas React/TypeScript estilizadas con Tailwind y conectadas mediante Axios; verificar en navegador alta, errores por campo del cliente y API, y edición persistente en SQLite.
- [x] 3.4 Entregar recetas deploy.yml para Node.js, Laravel y WordPress y referencia del contrato; verificar su validación y documentar herramientas, adaptación de rutas/servicios, preservación de datos y migraciones explícitas.

## 4. Ejecución manual

- [x] 4.1 Implementar aceptación transaccional con instantánea sanitizada, cola persistente y trabajador único; probar doble solicitud, conflicto 409, orden entre proyectos y que cambios de YAML no alteran una ejecución aceptada.
- [x] 4.2 Implementar procesos sin shell implícito, directorios verificados y entorno mínimo; probar con ejecutables de prueba el paso literal de argumentos, orden, fallo de inicio, salida no cero y omisión de pasos posteriores.
- [x] 4.3 Implementar timeout y terminación del grupo con escalamiento a SIGKILL; comprobar que procesos hijos no sobreviven y el siguiente trabajo puede comenzar al liberar bloqueo.
- [ ] 4.4 Implementar recuperación de ejecuciones pendientes/en curso tras reinicio y bloqueo cuando no se garantiza fin de procesos anteriores; verificar reinicio bajo systemd con un proceso hijo activo sin repetir comandos.
- [ ] 4.5 Documentar permisos mínimos y recuperación manual de despliegues parciales, incluido mantenimiento Laravel; verificar las instrucciones contra recetas y usuario de servicio de prueba.

## 5. Logs e historial

- [x] 5.1 Capturar stdout/stderr con paso y secuencia, ocultación incremental y límite de diez MiB; probar secretos fragmentados, canales separados, truncamiento y drenaje de salida tras alcanzar el límite.
- [x] 5.2 Persistir estados, tiempos y causas; implementar historial paginado y logs con cursor; probar lectura tras reinicio y fallos de escritura sin falsos estados exitosos.
- [x] 5.3 Implementar limpieza configurable a treinta días; verificar eliminación de archivos/registros vencidos y preservación de ejecuciones activas con reloj controlado, y documentar respaldo y retención.
- [ ] 5.4 Crear detalle React/TypeScript con Tailwind y seguimiento Axios cada dos segundos, botón manual y estados de error; verificar éxito, fallo, timeout, desconexión, conflicto, escape de HTML y cancelación de consultas al salir de la vista.

## 6. Instalación e integración

- [ ] 6.1 Entregar unidad systemd con KillMode=control-group y guía de proxy HTTPS, directorios privados y herramientas externas; validar la unidad y comprobar arranque bajo usuario limitado en Linux.
- [ ] 6.2 Ejecutar integración en entorno Linux desechable con proyectos de prueba Node.js, Laravel y WordPress; comprobar actualización, verificación final, historial y preservación de archivos persistentes sin tocar aplicaciones reales.
- [x] 6.3 Ejecutar build, lint y suite completa, y recorrer inicio de sesión → registro → validación → despliegue → diagnóstico de error; registrar resultados y limitaciones del entorno en la documentación de validación.
