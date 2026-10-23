# Spec Delta

## Purpose

Restringir el panel y las operaciones de despliegue al administrador del servidor mediante autenticación y sesiones privadas.

## ADDED Requirements

### Requirement: Acceso autenticado
El sistema SHALL exigir una sesión de administrador para consultar proyectos, configuraciones, historial y logs o ejecutar operaciones. Las credenciales iniciales MUST establecerse fuera del panel sin valores predeterminados públicos.

#### Scenario: Petición sin sesión
- **WHEN** un visitante solicita proyectos o intenta desplegar sin autenticarse
- **THEN** el sistema rechaza la operación y no revela datos ni ejecuta comandos.

#### Scenario: Inicio y cierre de sesión
- **WHEN** el administrador ingresa credenciales válidas y después cierra sesión
- **THEN** obtiene acceso durante la sesión y la sesión queda invalidada al cerrarla.

### Requirement: Protección de sesión y operaciones
El sistema SHALL limitar intentos de acceso, expirar sesiones y rechazar mutaciones sin protección contra peticiones de otros sitios. Las cookies MUST ser HttpOnly, SameSite y Secure en producción HTTPS.

#### Scenario: Petición de otro sitio
- **WHEN** una petición de despliegue lleva una sesión pero carece de un token antifalsificación válido
- **THEN** se rechaza sin crear una ejecución.

#### Scenario: Intentos reiterados
- **WHEN** un origen supera diez intentos de inicio de sesión en quince minutos
- **THEN** los nuevos intentos se rechazan hasta terminar esa ventana.

#### Scenario: Sesión expirada
- **WHEN** una sesión supera ocho horas desde su creación
- **THEN** el sistema exige autenticación nuevamente.
