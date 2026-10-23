# Evidencia de validación

Suite automatizada: 14 pruebas aprobadas.

Validación local realizada el 22 de octubre de 2026, en macOS con Node.js 24.16.0.

## Comprobaciones reproducibles

- `npm run lint`: comprobación estricta de tipos del servidor y cliente.
- `npm test`: compila cliente/servidor y ejecuta pruebas con directorios y SQLite temporales. Incluye esquema YAML, límites, rutas/symlinks, recetas de los tres tipos, sesiones, CSRF, expiración, limitación de intentos, conflictos, edición activa, cola secuencial, procesos sin shell, fallos, timeout con descendientes, logs fragmentados, truncamiento, retención, recuperación y fallback del dashboard compilado.
- `npm audit`: auditoría de dependencias; tras actualizar @fastify/static a la versión corregida 10.1.7 no se reportaron vulnerabilidades.
- OpenSpec: `openspec validate build-deployment-panel --strict`.

## Recorrido de navegador

Servidor compilado en localhost con datos privados temporales y una aplicación de prueba Node.js fuera del proyecto. Se verificó inicio de sesión, alta de proyecto con React Hook Form, validación YAML, ejecución manual, actualización de estado y logs, éxito, historial y fallo con código de salida 2 y pasos posteriores omitidos. Una salida que contenía `<script>` se mostró literalmente como texto. Se verificaron además edición persistente, errores por campo y retorno al acceso al invalidar la sesión temporal. Quedan pendientes en navegador los escenarios de timeout, desconexión, conflicto y cancelación al abandonar la vista; su lógica está implementada y timeout/conflicto se cubren en las pruebas de API/ejecutor.

## Verificación pendiente en Linux

Este equipo no dispone de systemd. El ejecutable Docker existe, pero no tiene daemon disponible. Por ello no se declara verificada la instalación systemd, su control de grupos bajo reinicio, los permisos de un usuario de servicio Linux ni un despliegue real de Laravel/WordPress. Las recetas se validaron contra el contrato, sin ejecutar comandos sobre aplicaciones reales.

Antes de producción, en un servidor/VM Linux desechable:

1. Seguir docs/linux.md con un usuario sin privilegios. Validar la unidad con `systemd-analyze verify` y arrancarla con sus rutas de escritura limitadas.
2. Crear proyectos de prueba con Git local, un servicio Node.js con healthcheck, una instalación Laravel de prueba y un tema WordPress con archivos persistentes ajenos al repositorio.
3. Adaptar recetas, registrar y ejecutar cada proyecto; comprobar código actualizado, check final exitoso e historial/logs después de reiniciar el panel.
4. Introducir una salida no cero y un timeout; comprobar pasos omitidos y ausencia de descendientes supervivientes.
5. Reiniciar systemd durante un comando con hijos que ignoren SIGTERM; comprobar que systemd elimina el grupo, el panel marca interrupción y no repite pasos.
6. Verificar que .env, uploads, wp-config.php y base de datos permanecen intactos; simular fallo de almacenamiento y respaldo/restauración del panel.
7. Recorrer errores de formularios, edición persistente, sesión expirada, desconexión y conflicto desde el navegador. Confirmar cookies Secure detrás del proxy HTTPS.

Mantener pendientes las tareas que exigen esas comprobaciones hasta disponer de evidencia. No archivar el cambio por el solo hecho de que compile.
