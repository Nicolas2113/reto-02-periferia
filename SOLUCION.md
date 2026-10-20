# Solución — documento en preparación

Fuente única de requisitos: PRD.md. Estado actual: leer_buzon y extraer implementados, TypeScript estricto aprobado y 20 pruebas (15 HU-2 + 5 HU-1) aprobadas; resto del núcleo, demo y aplicación pendientes. Las decisiones del borrador archivado no se consideran aprobadas ni implementadas.

## 1. Problema y usuario
Pendiente.
## 2. Arquitectura
Separación de carpetas conforme al PRD 6.5; implementación pendiente.
## 3. Ciclo del agente
Pendiente.
## 4. Modelo y costo
Proveedor sin elegir. No se han realizado llamadas a modelos desde el proyecto.
## 5. Extracción y confianza
Extraer usa regex/heurísticas sobre el TXT contractual, con esquema zod, evidencia por campo y advertencias. No consulta maestro ni comerciales. Ausencias null/0, incluso objeto/inicio del otrosí; solo extrae valor/plazo explícitos. Escala ordinal no calibrada: literal 0.9, inferencia simple 0.8, fecha derivada 0.7, valor por demanda 0.5 y ausencia 0. En msg-006 valor es 0 por demanda, no el umbral de póliza; fechas y moneda quedan null y aplicabilidad de póliza queda pendiente, con condición explícita. Metadatos de registro quedan null/0 para fases posteriores. Parser limitado a los formatos de cláusulas, montos y fechas de los TXT entregados. Detalles y pruebas en specs/hu-02-extraer.md.
## 6. Regla de gobierno
Pendiente.
## 7. Decisiones y alternativas
- HU-1 reconoce contrato/otrosí por el título del TXT adjunto normalizado sin tildes; no basta con el nombre del archivo o con mencionar contrato en el cuerpo. OCR y PDF no se implementan en este bloque P0.
- Leer no marca mensajes como procesados ni modifica maestro/fixtures; únicamente añade la bitácora exigida por RN7. Los rechazos se devuelven con motivo para que el flujo posterior decida su tratamiento.
- Un correo inválido se informa en data.errores y el lote continúa; un procesados.json corrupto devuelve error global para no volver a procesar correos por asumir incorrectamente un estado vacío.
- Dependencias locales: zod 3.25.76 valida correo, estado y entrada; TypeScript 5.9.3 comprueba tipos; @types/node 24.10.0 aporta tipos de la API estándar. Sin framework, ejecutor TS adicional ni scripts de instalación; registro oficial npm, versiones exactas en package-lock.json.
## 8. Supuestos y ambigüedades
HU-1 acepta procesados.json como objeto con IDs como claves o lista de IDs; la herramienta no produce ese archivo. Los adjuntos TXT entregados son la fuente de detección documental. Estas decisiones no son reglas nuevas del PRD.
Extracción preserva ausencias del otrosí para resolverlas por combinación posterior; póliza condicional se señala sin afirmar aplicabilidad global. Pendiente de confirmar con persona: día de firma/fin de msg-006 y aplicabilidad de póliza. También pendientes: bitácora de duplicados y rúbrica anunciada pero ausente. Consultar PRD y documentar las decisiones efectivas aquí.
## 9. Cobertura
HU-1 implementada: pendientes, campos exigidos, clasificación rechazada con motivo. Verificado con cinco pruebas y npm run check. HU-2 implementada y verificada: 15 pruebas nuevas más 5 de regresión HU-1 y typecheck, sin registrar datos. HU-3 a HU-5, demo, chat, LLM y despliegue pendientes; HU-6 cubierto para lectura/extracción. Las pruebas aíslan datos generados dentro de out/ y comparan hashes de los fixtures originales y bytes de PRD.md.
## 10. Uso de IA
Se usó ChatGPT/Codex para lectura y análisis del PRD, revisión del entorno, planificación y borradores iniciales de tipos/almacenamiento e implementación de leer_buzon y extraer con pruebas, así como las specs por historia. No se usó IA en ejecución de la herramienta ni se hicieron llamadas al LLM desde el proyecto. Se descartó mantener una segunda especificación porque duplicaba el PRD; el borrador anterior se conserva archivado. Nicolás debe revisar y comprender el código antes de entregarlo. Registro por completar conforme avance el trabajo.
## 11. Riesgos de producción
Pendiente.
