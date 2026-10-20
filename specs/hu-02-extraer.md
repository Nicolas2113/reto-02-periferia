# HU-2 — Extraer datos del contrato

Estado: implementada después de la spec inicial, con pruebas. Fuente única: PRD.md HU-2, §6.2, §7.2; casos §7.4, errores HU-6 y bitácora RN7. No incluye validación/clasificación de HU-3 ni registro de HU-4.

## Contrato implementado

src/tools/contratos.ts exporta extraer (contratos_extraer), con description, args.mensaje_id validado con zod y .describe(), y execute(args, ctx). Helper mínimo y esquema: src/extraccion.ts. Rutas desde ctx.directory, sin ID usado como ruta arbitraria ni rutas absolutas codificadas. No hay LLM ni lectura del maestro/comerciales.

Retorno string JSON { ok: true, data: Contrato } o { ok: false, error }; execute captura los errores. Adjunto/mensaje inexistente, texto vacío, moneda contractual desconocida, monto mal formado, fecha inválida, cotización y rutas inseguras se informan sin lanzar. Si hay más de un contrato TXT se pide seleccionar adjunto, sin elegir uno silenciosamente.

Salida: las 16 propiedades de §7.2 con tipos validados y null durante extracción cuando no hay dato; confianza por propiedad, evidencias y advertencias. Auxiliares explícitos, no columnas nuevas del maestro: valor_indeterminado, plazo_meses, poliza_condicional y tipo_documento. También tienen confianza. Ausencias siempre null/0. Comercial, estado de póliza, ruta, fecha de registro y fuente quedan null/0; se resolverán en las fases correspondientes, sin confundirlos con datos contractuales dudosos.

Solo lee el TXT contractual declarado en correo.json, incluido otrosi.txt; escribe exclusivamente la bitácora out/log.jsonl. No escribe maestro/procesados ni archiva documentos.

## Casos verificados

| Caso | Resultado real |
|---|---|
| msg-001 | CT-2026-015, NIT 890900111, CO, COP 265000000, 2026-08-01 a 2027-07-31; póliza de cumplimiento. |
| msg-002 | CT-2026-016, RUC 1790012345001, EC, USD 120000, 2026-08-15 a 2027-08-14; sin cláusula de garantía en el texto completo. |
| msg-003 | Otrosí CT-2026-011, PE, PEN 520000, fin 2027-11-01. Objeto e inicio null/0; no usa la fecha de suscripción como inicio ni rellena desde el maestro. |
| msg-004 | CT-2026-012, COP 210000000, 2026-05-15 a 2026-11-14. Extrae, no clasifica como duplicado. |
| msg-005 | Error legible de documento no contractual. No convierte la cotización en contrato. |
| msg-006 | CM-2026-03, valor 0 por demanda, valor_indeterminado true, plazo 12 meses; inicio/fin y moneda null/0. El umbral de garantía COP 100000000 no se usa como valor ni moneda contractual. poliza_condicional true, tipo cumplimiento y requiere_poliza null/0, con advertencia explícita. |

## Heurística y decisiones conservadoras

Confianza es escala ordinal de evidencia, no probabilidad calibrada: 0.9 literal, 0.8 inferencia simple, 0.7 derivación de fecha, 0.5 representación de valor por demanda que requiere revisión, 0 ausencia. Evidencias indica el texto o la regla usada; no son porcentajes de exactitud.

- País inferido del domicilio de la contraparte, sin usar la sede colombiana de Periferia. Se quita DV solo al NIT separado por guion; RUC conserva los dígitos entregados, coherente con los fixtures.
- Sin garantía en un contrato con partes, objeto y cierre de firma se infiere requiere_poliza false (0.8) y tipo vacío. No se aplica esa inferencia a un otrosí ni a texto parcial. Es una heurística del TXT entregado, no una revisión jurídica.
- Garantía condicional no se traduce en obligación global. En msg-006 se conserva null para aplicabilidad hasta revisión humana. La ausencia de día de firma nunca se suple con fecha del correo ni con una fecha inventada.
- Si hay inicio completo y plazo sin fin, se calcula inicio + meses - un día (fin inclusivo, confianza 0.7); inicios de día 29–31 se dejan pendientes por ambigüedad de fin de mes. Si no hay inicio, no se calcula fin.
- Objeto se recorta a máximo 200 caracteres en límite de palabra, avisando y conservando texto completo en evidencias. ID ausente queda null/0; AUTO corresponde a registro posterior.

## Pruebas reales

npm run check aprobado. npm test: 20 aprobadas, 0 fallidas (15 HU-2 y 5 regresión HU-1), con Node 24.16.0. Pruebas de nuevos COP/USD, otrosí PEN parcial, duplicado sin clasificar, cotización, demanda/condición, determinismo, calendario, moneda, montos, texto vacío, IDs/rutas, adjuntos ausentes, esquema zod y fin derivado. El script enumera ambos archivos de prueba sin depender de expansión de comodines del shell.

La prueba de independencia elimina maestro/comerciales únicamente de una copia dentro de out/ y obtiene la misma extracción del otrosí. Solo aparece log.jsonl como salida de extracción; se comparan hashes de fixtures y bytes del PRD originales. Los datos mutados son copias de prueba; no se altera el material entregado.

## Límites y siguientes historias

Parser deliberadamente acotado a la familia de TXT entregada: cláusulas por párrafos con encabezados, montos con código de moneda y separadores válidos, fechas ISO o día numérico (también entre paréntesis) y mes español. No OCR/PDF, fechas solo escritas en palabras ni comprensión jurídica general. Fuera de esos patrones conserva ausencias; no afirma cobertura universal.

HU-3 deberá combinar el parche del otrosí con el maestro, resolver comercial y separar campos operativos de campos que requieren revisión. HU-4 deberá exigir datos completos y confirmación humana real antes de registrar; un confirmado true del modelo no la sustituye. Falta acordar aplicabilidad de la póliza condicional y fechas completas de msg-006 con la usuaria. No se han implementado HU-3+, demo, API/chat, LLM ni despliegue.

SOLUCION.md permanece en la raíz y registra decisiones y asistencia reales. ChatGPT/Codex asistió con esta spec, implementación y pruebas; no se consultó un LLM desde la herramienta.
