# Proposal

## Why

Los despliegues de aplicaciones Node.js, Laravel y WordPress necesitan un procedimiento repetible y visibilidad sobre sus resultados. Un panel central en el mismo servidor Linux permitirá ejecutarlos manualmente y consultar qué pasos funcionaron o fallaron.

## What Changes

- Crear una API Node.js con TypeScript y un dashboard privado React con TypeScript y Tailwind CSS para un administrador.
- Usar Axios para consumir la API y React Hook Form para gestionar los formularios del dashboard.
- Guardar registros de proyectos, sesiones, despliegues y pasos en SQLite; conservar la salida de logs en archivos privados.
- Registrar proyectos, tipo de aplicación, directorio local y ubicación de un archivo YAML de despliegue.
- Validar YAML antes de ejecutar y guardar una copia de la configuración utilizada en cada ejecución.
- Ejecutar secuencias configurables para actualizar código, instalar dependencias, construir y reiniciar servicios según cada aplicación.
- Mostrar estado, pasos, tiempos, salida y errores; conservar historial y logs con secretos ocultos.
- Impedir despliegues simultáneos sobre el mismo proyecto o directorio y marcar ejecuciones interrumpidas tras reiniciar el panel.
- Incluir ejemplos para Node.js, Laravel y WordPress sin sobrescribir archivos persistentes por defecto.

Primera versión: despliegue manual en un único servidor. Quedan fuera webhooks, programación, SSH, múltiples usuarios/roles, rollback automático, aprovisionamiento y garantías de cero interrupciones.

## Capabilities

### New Capabilities

- `panel-access`: acceso privado del administrador y protección de operaciones.
- `project-configuration`: registro de proyectos y contrato YAML validado.
- `deployment-execution`: ejecución manual ordenada, aislamiento de rutas y control de concurrencia.
- `deployment-observability`: estados, historial y logs por despliegue y paso.

### Modified Capabilities

Ninguna; el proyecto solo contiene la configuración inicial de OpenSpec.

## Impact

Se incorporarán una API Node.js/TypeScript, un dashboard React/TypeScript con Tailwind CSS, Axios y React Hook Form, persistencia SQLite, un ejecutor de procesos y documentación de instalación Linux. El proceso necesitará permisos limitados sobre los directorios registrados y herramientas externas instaladas según el proyecto (Git, Node/npm, PHP/Composer o WP-CLI). Los comandos YAML son código confiable administrado por el propietario del servidor.
