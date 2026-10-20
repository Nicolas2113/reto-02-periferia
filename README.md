# Registro de Contratos Vigentes — reto 02

Estado: estructura preparada; funcionalidad pendiente. No hay servidor, demo operativa ni proveedor elegido. No se han instalado dependencias.

La fuente única de requisitos es PRD.md, conservado en la raíz. TAREAS.md contiene la lista breve de trabajo trazable al PRD.

La estructura sigue PRD 6.5: agent/prompt.md, src/server.ts, src/llm/adapter.ts, src/tools/contratos.ts, src/knowledge/registro-contratos.md, web/, fixtures/, out/, demo.ts, .env.example, package.json, README.md y SOLUCION.md. No se crea un archivo de proveedor hasta elegir uno.

Los fixtures permanecen exactamente en fixtures/reto-02/, sin cambios. out/ está vacío y reservado a datos generados.

Archivos adicionales: tsconfig.json y .gitignore son configuración de proyecto; TAREAS.md registra tareas/pruebas. Los borradores previos domain.ts, storage.ts y SPEC-borrador-no-usar.md están conservados fuera del proyecto, en el directorio temporal reto-02-build. docs/ quedó vacío tras trasladar el borrador; no se eliminó ningún archivo. No existe otra especificación activa en el proyecto.

Los scripts de package.json son preparación para el siguiente bloque; no implican que exista una aplicación ejecutable. Arranque, variables definitivas, demo y enlace se documentarán cuando estén implementados y verificados.
