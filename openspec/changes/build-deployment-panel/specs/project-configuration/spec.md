# Spec Delta

## Purpose

Permitir registrar aplicaciones locales y definir su procedimiento reproducible de despliegue mediante archivos YAML validados.

## ADDED Requirements

### Requirement: Registro de proyectos locales
El sistema SHALL permitir crear, consultar y editar proyectos con identificador, nombre, tipo (node, laravel o wordpress), directorio absoluto y ruta YAML relativa a ese directorio. El directorio MUST existir dentro de las raíces autorizadas por el operador y no coincidir ni solaparse con otro proyecto.

#### Scenario: Registro válido
- **WHEN** el administrador registra una aplicación con un directorio permitido y configuración válida
- **THEN** el panel la muestra y permite solicitar su despliegue.

#### Scenario: Ruta fuera de alcance
- **WHEN** la ruta real resuelta mediante enlaces simbólicos sale de las raíces autorizadas o se solapa con otro proyecto
- **THEN** el registro se rechaza con un error específico.

### Requirement: Contrato YAML versionado
El sistema SHALL aceptar YAML versión 1 con tipo, pasos ordenados (identificador único, ejecutable, argumentos, timeout y directorio opcionales) y referencias opcionales a secretos del servidor. MUST exigir un último paso llamado verify y rechazar claves desconocidas, tipos incompatibles, pasos vacíos y rutas fuera del proyecto antes de ejecutar.

#### Scenario: Archivo inválido
- **WHEN** el archivo no existe, no puede leerse o incumple el esquema
- **THEN** el panel muestra el campo o causa del error sin ejecutar procesos.

#### Scenario: Referencia secreta ausente
- **WHEN** un paso referencia una variable de entorno que no está disponible
- **THEN** la validación impide desplegar y muestra su nombre sin revelar otros valores.

### Requirement: Configuración reproducible
El sistema SHALL releer y validar el YAML en cada solicitud, conservar una instantánea sin valores secretos y ejecutar exclusivamente esa instantánea. Cambiar proyecto o archivo durante una ejecución MUST NOT alterar los pasos ya aceptados; editar el registro activo MUST rechazarse.

#### Scenario: Cambio del YAML en ejecución
- **WHEN** el archivo cambia después de aceptar un despliegue
- **THEN** los pasos conservan la versión aceptada y el siguiente despliegue toma el archivo actualizado.

### Requirement: Ejemplos por tipo de aplicación
El sistema SHALL documentar recetas YAML para Node.js, Laravel y WordPress con herramientas necesarias, actualización de código y comprobación final. Los ejemplos MUST preservar .env, archivos subidos y datos persistentes, y presentar migraciones como una decisión explícita del administrador.

#### Scenario: Adopción de una receta
- **WHEN** el administrador usa un ejemplo documentado
- **THEN** puede identificar qué rutas y servicios debe adaptar y qué pasos modifican código, servicios o base de datos.
