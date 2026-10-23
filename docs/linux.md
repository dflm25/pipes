# Instalación en un servidor Linux

Requiere Node.js 24+, systemd, proxy HTTPS y herramientas de tus recetas. La aplicación no aprovisiona PHP, bases de datos ni servidores web. Instala el código en `/opt/lucudeploy`, ejecuta `npm ci` y `npm run build` durante la preparación.

1. Crea un usuario de servicio `lucudeploy` sin privilegios administrativos y un grupo compartido `deployers`. Concede solo lectura/ejecución a binarios y acceso a las aplicaciones autorizadas; los directorios que el deploy modifica deben permitir escritura por grupo. El panel no debe poder editar su propio código.
2. Crea `/var/lib/lucudeploy` propiedad del usuario del servicio con modo 0700. SQLite, sesiones y logs residen aquí, nunca dentro de aplicaciones desplegadas. No alojarlos en NFS.
3. Crea `/etc/lucudeploy.env` con modo 0600 y propietario root; adapta `.env.example`: `DATA_DIR=/var/lib/lucudeploy`, `DEPLOY_ROOTS=/srv/apps`, `NODE_ENV=production`, `TRUST_PROXY=127.0.0.1,::1`. Añade solo las variables requeridas por tus recetas.
4. Configura administrador mediante `npm run admin` con el mismo entorno y usuario de servicio; si usas `/etc/lucudeploy.env`, el operador debe cargarlo en ese proceso sin publicar sus valores. Alternativamente, ejecuta `node --env-file=/etc/lucudeploy.env --import tsx server/admin.ts` mediante el mecanismo administrativo local apropiado, garantizando que los archivos resultantes pertenezcan al usuario del servicio. No pasar la contraseña en argumentos.
5. Adapta `ops/lucudeploy.service` a tus rutas. Instala la unidad, valida con `systemd-analyze verify`, recarga systemd y habilita el servicio. El ejemplo permite escritura solo en datos y `/srv/apps`; añade rutas específicas de PM2 u otras herramientas si las necesitan. Los proyectos fuera de `/srv/apps` requieren actualizar también `ReadWritePaths`.
6. Integra `ops/nginx.conf` en el virtual host HTTPS existente. `Secure` exige HTTPS en producción; no exponer el puerto 3400. Autoriza solo las IP/CIDR reales de tu proxy.
7. Verifica con una aplicación de prueba: login, registro, YAML, éxito, fallo y reinicio durante un paso con hijos. Revisa `journalctl -u lucudeploy` sin volcar el entorno.

`KillMode=control-group` y `TimeoutStopSec=20` garantizan que systemd termine descendientes antes de iniciar otra instancia. Si al arrancar aún hay un grupo de un trabajo anterior vivo, el servicio rechaza la recuperación: el operador debe detenerlo antes de reintentar. No ejecutar instancias fuera de systemd en producción ni adoptar procesos daemonizados como parte de la receta. La aplicación rechaza correr como root en producción.

`NoNewPrivileges=yes` impide elevar privilegios con sudo: usa servicios y gestores ya accesibles al usuario o un mecanismo de reinicio externo limitado. Nunca dar sudo general al panel. Configura las credenciales Git para el usuario de servicio sin prompts interactivos. Los scripts de dependencias también ejecutan código confiable con sus permisos.

## Datos, retención y retirada

Logs separados por despliegue, con máximo diez MiB de captura; al truncarse aparece un marcador y el comando sigue drenándose. El panel lee páginas de hasta 128 KiB. Se muestran los últimos 2000 registros en la vista; el archivo completo permanece hasta su vencimiento. La retención predeterminada es treinta días y se aplica al arrancar y cada hora, solo a ejecuciones finalizadas. `RETENTION_DAYS` puede modificarse entre 1 y 3650.

Para respaldar, detén el servicio y copia el directorio privado completo (SQLite y logs); conserva permisos. No copies solo el archivo SQLite con el servicio activo porque usa WAL. Para restaurar, detén el servicio, repón datos bajo el mismo usuario y arranca; las ejecuciones anteriores no se reanudan. Para retirar el panel, deshabilita el servicio y conserva el respaldo; los gestores de aplicaciones existentes siguen siendo independientes.
