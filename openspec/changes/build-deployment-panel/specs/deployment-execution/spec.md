# Spec Delta

## Purpose

Ejecutar despliegues manuales locales con pasos ordenados y resultados verificables, evitando conflictos entre ejecuciones.

## ADDED Requirements

### Requirement: Inicio manual y exclusión mutua
El sistema SHALL aceptar despliegues solo mediante una acción explícita autenticada y responder con un identificador persistente. MUST aceptar como máximo una ejecución activa por proyecto o ruta real solapada y rechazar solicitudes adicionales con referencia a la ejecución activa.

#### Scenario: Inicio desde el panel
- **WHEN** el administrador pulsa Desplegar sobre un proyecto válido sin ejecución activa
- **THEN** se crea una ejecución pendiente, visible en su historial, y se inicia el procesamiento local.

#### Scenario: Doble clic concurrente
- **WHEN** llegan dos solicitudes simultáneas para el mismo proyecto
- **THEN** solo una se acepta y la otra informa el conflicto sin iniciar procesos.

### Requirement: Secuencia y resultado
El sistema SHALL ejecutar cada paso en orden, con su directorio y argumentos configurados. MUST detenerse ante salida distinta de cero, señal, fallo al iniciar o timeout; los pasos restantes quedan omitidos. Solo SHALL marcar éxito si todos los pasos, incluida una comprobación final configurada, terminan correctamente.

#### Scenario: Error de dependencias
- **WHEN** falla el paso de instalación
- **THEN** no se ejecuta el reinicio posterior y el despliegue termina fallido con el paso y código de salida disponibles.

#### Scenario: Tiempo agotado
- **WHEN** un paso supera su timeout
- **THEN** se termina su grupo de procesos, se registra timeout y no se inician más pasos.

#### Scenario: Secuencia completa
- **WHEN** todos los pasos terminan con código cero
- **THEN** el despliegue termina exitoso y se libera el bloqueo.

### Requirement: Ejecución restringida
El sistema SHALL ejecutar comandos como usuario de servicio sin privilegios administrativos generales, separar ejecutable y argumentos y validar rutas reales antes de cada paso. MUST NOT aceptar comandos ad hoc desde la solicitud de despliegue. Solo el operador del servidor SHALL modificar archivos YAML confiables.

#### Scenario: Argumento con caracteres de shell
- **WHEN** un argumento contiene caracteres de sustitución o separadores
- **THEN** se pasa literalmente al ejecutable sin interpretación implícita por un shell.

#### Scenario: Ruta sustituida
- **WHEN** el directorio de un paso resuelve fuera del proyecto al comenzar
- **THEN** se detiene la ejecución antes de lanzar ese proceso.

### Requirement: Recuperación tras interrupción
El sistema SHALL marcar como interrumpidas las ejecuciones pendientes o en curso de una instancia anterior, terminar procesos supervivientes antes de liberar sus bloqueos y exigir un nuevo inicio manual. MUST NOT reanudar pasos ni declarar éxito automáticamente.

#### Scenario: Reinicio durante despliegue
- **WHEN** el servicio se reinicia tras una caída durante un paso
- **THEN** el historial muestra interrupción, no se repiten comandos y solo permite otro despliegue tras confirmar que no quedan procesos anteriores activos.
