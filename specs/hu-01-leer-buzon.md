# HU-1 — Leer el buzón

Documento retrospectivo: se escribe después de implementar y verificar HU-1. No se afirma que precedió al código. PRD.md sigue siendo la única fuente de requisitos.

## Referencias y alcance

PRD §5 HU-1, §6.2 (contrato de herramientas), §7.4 (seis casos); manejo de errores HU-6 y bitácora RN7. Implementación: src/tools/contratos.ts, export leer_buzon, nombre del modelo contratos_leer_buzon. Pruebas: tests/leer-buzon.test.ts.

Lee fixtures/reto-02/buzon/ desde ctx.directory y excluye IDs de out/procesados.json. Devuelve los campos de HU-1, tiene_contrato y, para mensajes sin contrato, clasificacion rechazado con motivo. El resultado es string JSON; errores de un correo se informan en data.errores sin abortar los demás. No extrae campos contractuales ni registra contratos o mensajes procesados. Solo escribe out/log.jsonl.

## Decisiones y ambigüedades

- Reconocimiento por título del TXT normalizado sin tildes: contrato u otrosí al contrato. No basta el nombre del archivo o una mención en el correo. PDF/OCR fuera de este bloque P0.
- El PRD no fija el esquema de procesados.json: se admite objeto con IDs como claves o lista de IDs. Si no existe, todos están pendientes; si es corrupto, se devuelve error, sin suponer estado vacío.
- Entrada vacía validada con zod; cada llamada deja bitácora. Los rechazos se devuelven sin marcar el mensaje como procesado; ese paso pertenece al flujo posterior.
- Dependencias locales oficiales con versiones exactas: zod 3.25.76, TypeScript 5.9.3 y @types/node 24.10.0. El lockfile incluye la dependencia transitiva de tipos. No hay dependencia global ni LLM en ejecución.

## Pruebas y resultados reales

Ejecutadas antes de esta reorganización: npm run check aprobado (TypeScript estricto); npm test: 5 pruebas aprobadas, 0 fallidas.

1. Seis IDs en orden, cinco adjuntos de contrato, msg-003 reconocido como otrosí y msg-005 rechazado con motivo; bitácora presente y ningún procesados.json creado; PRD y fixtures originales intactos.
2. Excluir msg-001/msg-005 ya procesados sin alterar procesados.json.
3. JSON de procesados corrupto produce error legible sin lanzar.
4. Un correo JSON corrupto permite leer los otros cinco.
5. Argumentos inesperados se rechazan con zod.

Los datos mutados por las pruebas son copias aisladas dentro de out/; se limpian solo sus directorios temporales propios. No se ejecutaron de nuevo las pruebas en esta limpieza exclusivamente documental.

## Pendientes y entrega

- Revisar esta HU con Nicolás; integrar con el flujo posterior cuando se autorice. No implica que estén implementadas las otras herramientas, demo, servidor, chat, LLM ni despliegue.
- SOLUCION.md permanece en la raíz como documento obligatorio según PRD §9.1: completarlo antes de entregar, incluyendo declaración real de IA. No se afirma cumplimiento final.
- TAREAS.md se trasladó intacto a respaldo recuperable fuera del proyecto, con nombre único fechado. SOLUCION.md fue restaurado intacto a la raíz al recibir la corrección del usuario; su copia externa también se conserva. La declaración de asistencia IA completa del estado actual permanece en SOLUCION.md; para HU-1, ChatGPT/Codex asistió con implementación, pruebas y documentación. No hubo llamadas LLM desde la herramienta. Se descartó la segunda especificación general por duplicar el PRD.

Respaldos recuperables de esta operación:
- C:\Users\nicoM\Documents\Codex\2026-10-20\task\reto-02-build\SOLUCION-20261020T205120685Z.md
- C:\Users\nicoM\Documents\Codex\2026-10-20\task\reto-02-build\TAREAS-20261020T205120685Z.md
