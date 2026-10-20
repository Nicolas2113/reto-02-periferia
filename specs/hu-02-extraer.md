# HU-2 — Extraer datos del contrato

Estado: especificación previa a implementación; todavía sin código ni pruebas nuevas de HU-2. Fuente única de requisitos: PRD.md, HU-2, §6.2 y §7.2; casos §7.4, errores HU-6. HU-1 permanece sin cambios.

## Alcance y contrato

Implementar después de revisar esta spec: export extraer en src/tools/contratos.ts, nombre contratos_extraer. Objeto description/args/execute según §6.2; args.mensaje_id será un esquema zod descrito con .describe(). Recibe { mensaje_id } y contexto { directory, sessionId }; valida ID y resuelve rutas desde ctx.directory, sin rutas absolutas codificadas ni escapes del buzón.

execute devuelve string JSON: { ok: true, data: Contrato } o { ok: false, error }, nunca lanza. Mensaje/adjunto inexistente, texto vacío, formato inválido o moneda contractual no admitida producen error legible. Una cotización sin contrato no se convierte en Contrato: devuelve error de documento no contractual; la clasificación definitiva pertenece a HU-3.

Propuesta de salida para revisar: propiedades del esquema §7.2 con tipos allí definidos, admitiendo null durante extracción, más confianza: { [campo]: número entre 0 y 1 }. Cada campo ausente en el documento permanece null y confianza 0. Incluir valor_indeterminado para representar demanda conforme a §7.2. La forma final de este auxiliar y los metadatos de registro pendientes se discute abajo; no hay implementación implícita.

Regex y heurísticas sobre el TXT del adjunto indicado en correo.json, incluido otrosi.txt; no LLM ni consulta al maestro para completar datos. Igual texto/entrada produce iguales valores y confianza. Separadores numéricos, identificador tributario y fechas se normalizan conforme a §7.2 con validación de calendario. No registra contratos, no marca procesados ni modifica fixtures/maestro; bitácora de herramienta según RN7. Los valores finales deberán pasar por contratos_validar en HU-3.

## Aceptación prevista desde los fixtures

| Caso | Resultado a comprobar en HU-2 |
|---|---|
| msg-001 | CT-2026-015, cliente Industrias Delta, NIT 890900111, COP 265000000, inicio 2026-08-01, fin 2027-07-31; garantía de cumplimiento identificada. |
| msg-002 | CT-2026-016, contraparte ecuatoriana y RUC 1790012345001, USD 120000, 2026-08-15 a 2027-08-14; ausencia de cláusula de garantía se distingue de texto ausente. |
| msg-003 | Otrosí de CT-2026-011: PEN 520000 y fin 2027-11-01. Objeto e inicio no aparecen: null/confianza 0, sin recuperarlos del maestro. No confundir la fecha de suscripción mencionada con inicio contractual. Preservar/combinar campos corresponde a HU-3/HU-4. |
| msg-004 | Extraer CT-2026-012, COP 210000000 y fechas 2026-05-15 a 2026-11-14. No decidir duplicado: eso corresponde a HU-3. |
| msg-005 | Cotización: error legible de documento no contractual, sin extraer un supuesto contrato a partir de su importe. |
| msg-006 | CM-2026-03, demanda: valor 0 y valor_indeterminado true según §7.2, con confianza de valor inferior a 0.8 para la revisión exigida en §7.4. Firma solo indica agosto de 2026: inicio/fin null y confianza 0; conocer doce meses no determina fechas sin día inicial. COP 100000000 es umbral de garantía por orden, no valor contractual. Póliza condicional y moneda requieren criterio explícito, no una afirmación automática. |

Pruebas futuras: seis casos, rangos de confianza, ausencia null/0, dos extracciones iguales, IDs/rutas inválidos, texto vacío, moneda no admitida y fechas inválidas; conservar hashes de PRD/fixtures. No se agregaron ni ejecutaron estas pruebas en esta fase.

## Confianza y decisiones pendientes para revisión

La confianza será una puntuación heurística de evidencia, no probabilidad calibrada ni porcentaje de acierto. Documentar la regla que produce cada banda: literal inequívoco, inferencia, ambigüedad y ausencia. Ausencia es 0; ambigüedad e inferencias dudosas quedan debajo de 0.8; la escala exacta de campos legibles debe fijarse antes de implementar, sin decimales que aparenten precisión estadística.

Pendientes explícitos, no resueltos silenciosamente:

1. §7.2 mezcla datos contractuales con comercial/estado_poliza/ruta_sharepoint/fecha_registro/fuente. Propuesta: dejarlos null/0 si no están en el texto y resolverlos en validación/registro, sin inventarlos en extracción. Acordar el esquema de intercambio antes de codificar.
2. Sin cláusula de póliza (msg-002) frente a garantía condicional (msg-006): acordar booleano/tipo y confianza. El PRD exige revisión para msg-006; no convertir condición por orden en obligación incondicional sin confirmación.
3. Representación de valor_indeterminado (no es columna del CSV), evidencia del plazo en meses y moneda de msg-006: no inferir moneda del valor contractual solo por el umbral de garantía.
4. Cómputo de plazo y objetos largos: acordar fin inclusivo cuando sí haya inicio completo y tratamiento transparente del límite de 200 caracteres. ID ausente debe quedar sin inventar en HU-2; generación AUTO requiere coordinación con registro.

Siguiente paso: revisar estas decisiones con Nicolás; después implementar únicamente HU-2 y sus pruebas, conservando HU-1. SOLUCION.md permanece en la raíz y deberá documentar decisiones efectivas y asistencia IA antes de entregar. Esta spec fue preparada con ChatGPT/Codex; no se consultó un LLM desde el proyecto.
