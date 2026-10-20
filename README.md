# Registro de Contratos Vigentes — reto 02

Fuente única de requisitos: PRD.md, conservado intacto. TAREAS.md enlaza trabajo y pruebas al PRD; SOLUCION.md registra decisiones y asistencia IA.

## Estado comprobado

Solo contratos_leer_buzon (export leer_buzon de src/tools/contratos.ts) está implementado. Lee los fixtures, excluye IDs presentes en out/procesados.json, reconoce contratos/otrosíes TXT y rechaza cotizaciones con motivo. Devuelve JSON serializado, informa errores por correo y registra out/log.jsonl. No marca mensajes procesados ni altera fixtures.

Node 20+ es el runtime. Dependencias de proyecto declaradas y fijadas en package-lock.json; para reproducirlas: npm ci. En PowerShell puede usarse npm.cmd.

Comandos verificados en Windows con Node 24:

- npm run check: TypeScript estricto sin emitir archivos.
- npm test: compila y ejecuta cinco pruebas de HU-1/errores/inmutabilidad.
- npm run build: compila en dist/.

Las pruebas usan copias de datos únicamente dentro de out/ y limpian sus propios directorios temporales. node_modules/, dist/ y out/ están excluidos por .gitignore.

## Pendiente

No hay servidor, chat, integración LLM, demo operativa ni enlace de prueba. extraer, validar, registrar y alertas no están implementados. agent/prompt.md, adapter.ts y otros archivos de estructura siguen como marcadores; proveedor y variables definitivas aún sin elegir. No se requieren claves para las pruebas existentes.

La estructura sigue PRD §6.5. Los fixtures conservan fixtures/reto-02/. TAREAS.md, tsconfig.json, tests/ y .gitignore son archivos auxiliares de desarrollo. Los borradores previos domain.ts, storage.ts y SPEC-borrador-no-usar.md están fuera del proyecto, conservados en el directorio temporal reto-02-build. docs/ sigue vacío; el PRD es la única especificación vigente.
