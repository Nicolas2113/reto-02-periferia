# Solución — documento en preparación

Fuente única de requisitos: PRD.md. Estado actual: solo leer_buzon implementado y verificado con TypeScript estricto y cinco pruebas; resto del núcleo, demo y aplicación pendientes. Las decisiones del borrador archivado no se consideran aprobadas ni implementadas.

## 1. Problema y usuario
Pendiente.
## 2. Arquitectura
Separación de carpetas conforme al PRD 6.5; implementación pendiente.
## 3. Ciclo del agente
Pendiente.
## 4. Modelo y costo
Proveedor sin elegir. No se han realizado llamadas a modelos desde el proyecto.
## 5. Extracción y confianza
Pendiente.
## 6. Regla de gobierno
Pendiente.
## 7. Decisiones y alternativas
- HU-1 reconoce contrato/otrosí por el título del TXT adjunto normalizado sin tildes; no basta con el nombre del archivo o con mencionar contrato en el cuerpo. OCR y PDF no se implementan en este bloque P0.
- Leer no marca mensajes como procesados ni modifica maestro/fixtures; únicamente añade la bitácora exigida por RN7. Los rechazos se devuelven con motivo para que el flujo posterior decida su tratamiento.
- Un correo inválido se informa en data.errores y el lote continúa; un procesados.json corrupto devuelve error global para no volver a procesar correos por asumir incorrectamente un estado vacío.
- Dependencias locales: zod 3.25.76 valida correo, estado y entrada; TypeScript 5.9.3 comprueba tipos; @types/node 24.10.0 aporta tipos de la API estándar. Sin framework, ejecutor TS adicional ni scripts de instalación; registro oficial npm, versiones exactas en package-lock.json.
## 8. Supuestos y ambigüedades
HU-1 acepta procesados.json como objeto con IDs como claves o lista de IDs; la herramienta no produce ese archivo. Los adjuntos TXT entregados son la fuente de detección documental. Estas decisiones no son reglas nuevas del PRD.
Pendiente de resolver: día de firma de msg-006, póliza condicional, campos ausentes en otrosí, bitácora de duplicados y rúbrica anunciada pero ausente. Consultar PRD y documentar las decisiones efectivas aquí.
## 9. Cobertura
HU-1 implementada: pendientes, campos exigidos, clasificación rechazada con motivo. Verificado con cinco pruebas y npm run check. HU-2 a HU-5, demo, chat, LLM y despliegue pendientes; HU-6 cubierto únicamente para lectura de buzón. Las pruebas aíslan datos generados dentro de out/ y comparan hashes de los fixtures originales y bytes de PRD.md.
## 10. Uso de IA
Se usó ChatGPT/Codex para lectura y análisis del PRD, revisión del entorno, planificación y borradores iniciales de tipos/almacenamiento e implementación de leer_buzon con pruebas. No se usó IA en ejecución de la herramienta ni se hicieron llamadas al LLM desde el proyecto. Se descartó mantener una segunda especificación porque duplicaba el PRD; el borrador anterior se conserva archivado. Nicolás debe revisar y comprender el código antes de entregarlo. Registro por completar conforme avance el trabajo.
## 11. Riesgos de producción
Pendiente.
