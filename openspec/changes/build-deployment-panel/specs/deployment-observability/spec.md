# Spec Delta

## Purpose

Ofrecer evidencia persistente de cada despliegue y sus errores mediante estados, historial y logs consultables desde el panel.

## ADDED Requirements

### Requirement: Historial y estados
El sistema SHALL mostrar por proyecto la última ejecución y un historial paginado con identificador, origen manual, inicio, fin, duración y estado (pendiente, ejecutando, exitoso, fallido o interrumpido). Cada paso SHALL mostrar estado, tiempos y código de salida o motivo de terminación cuando corresponda.

#### Scenario: Consulta posterior
- **WHEN** el administrador vuelve al panel después de reiniciar el servicio
- **THEN** puede consultar ejecuciones terminadas y el detalle del paso fallido sin depender de memoria de la sesión.

### Requirement: Seguimiento de salida
El sistema SHALL capturar stdout y stderr por ejecución y paso, preservar su origen y mostrar nueva salida sin recargar la página mientras se ejecuta. MUST paginar o limitar cada lectura y señalar explícitamente si la captura se trunca por límite de almacenamiento.

#### Scenario: Error durante un paso
- **WHEN** un proceso escribe un error por stderr
- **THEN** el detalle lo muestra asociado al paso y lo conserva aunque el proceso termine después con fallo.

#### Scenario: Salida voluminosa
- **WHEN** se alcanza el límite de captura de diez MiB por ejecución
- **THEN** se agrega una marca de truncamiento y el proceso continúa sin llenar el disco con salida adicional.

### Requirement: Ocultación y visualización segura
El sistema SHALL sustituir valores de secretos referenciados por marcadores antes de persistir o transmitir salida, incluidos valores divididos entre fragmentos. MUST escapar salida no confiable en el panel y omitir valores secretos en instantáneas y errores propios.

#### Scenario: Secreto repartido en fragmentos
- **WHEN** un proceso emite un secreto registrado en varios fragmentos consecutivos
- **THEN** el valor completo no aparece en los logs persistidos ni en el panel.

#### Scenario: Texto con etiquetas HTML
- **WHEN** un comando emite etiquetas o scripts
- **THEN** se visualizan como texto sin ejecutarse en el navegador.

### Requirement: Conservación acotada
El sistema SHALL conservar historial y logs durante treinta días por defecto, con plazo configurable por el operador, y eliminar registros vencidos sin afectar ejecuciones activas. Los estados finales MUST persistirse incluso si falla el almacenamiento de logs; un fallo de persistencia MUST impedir declarar éxito.

#### Scenario: Limpieza periódica
- **WHEN** una ejecución terminada supera el plazo configurado
- **THEN** se eliminan sus logs y registros asociados mientras las ejecuciones activas permanecen disponibles.

#### Scenario: Fallo al guardar salida
- **WHEN** no se puede persistir la salida de un paso
- **THEN** se detiene la ejecución y se informa un fallo de observabilidad; si el almacenamiento está indisponible, la interfaz informa la indisponibilidad y la recuperación posterior no marca éxito.
