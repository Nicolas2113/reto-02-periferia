# Registro de Contratos Vigentes — reto 02

PRD.md es la fuente de requisitos. specs/ documenta decisiones y pruebas por historia; SOLUCION.md contiene arquitectura, gobierno, cobertura y asistencia IA. PRD y fixtures originales se conservan intactos.

## Preparación y arranque local

Requiere Node 20+ y npm; probado con Node 24.16.0 en Windows. En PowerShell puede usarse npm.cmd. Ollama debe estar disponible previamente en http://127.0.0.1:11434 con qwen3.5:4b instalado. No se descargan modelos ni se requieren claves de API. No hacen falta Bun, Docker, base de datos ni CLI de nube.

```bash
npm ci
npm run dev
```

npm run dev compila y arranca front/backend juntos en http://127.0.0.1:3000. npm start ejecuta la compilación existente. npm start fue ejecutado realmente: /api/health y el HTML respondieron HTTP 200 en loopback. npm run dev combina el build aprobado y ese mismo arranque; no se midió aparte su ejecución ni arranque en máquina limpia en menos de dos minutos. No hubo comprobación visual en navegador.

## Comprobaciones verificadas

```bash
npm run check
npm run build
npm test
npm run demo
```

Typecheck y build aprobados. Última suite completa: **37 pruebas, 0 fallidas**: 5 HU-1, 15 HU-2, 10 núcleo/demo y 7 backend. Incluye clasificación, otrosí, confianza/revisión, confirmación humana entre turnos, límites, timeout, idempotencia, errores de escritura, CSV, alertas, API y conservación de originales. Las pruebas del ciclo usan un proveedor fake explícito; no son una prueba del lote completo con Ollama.

La demo usa herramientas sin modelo con hoy=2026-09-03 y limpia únicamente out/ al comienzo. Procesa msg-001/002 como nuevos, msg-003 como actualización, msg-004 duplicado, msg-005 rechazado y msg-006 nuevo pendiente. Verificado: 10 filas antes y 11 después; otrosí cambia a PEN 520000 y fin 2027-11-01; historial contiene cuatro acciones contractuales. Repetición produce iguales resultados salvo timestamps.

La segunda pasada de demo aporta una confirmación humana **simulada**, no inferida del documento: valor=0, moneda=COP, inicio=2026-08-31, fin=2027-08-31, requiere_poliza=true y tipo=cumplimiento. Esos datos son explícitos y ficticios para probar el flujo; la usuaria real debe aclararlos. No ejecutar demo simultáneamente con una sesión de chat que necesite conservar out/.

## Configuración del backend

.env.example es referencia sin secretos; el proceso lee variables de entorno y usa estos valores por defecto. No carga automáticamente un archivo .env. No se requiere clave para Ollama local.

| Variable | Predeterminado |
|---|---|
| LLM_PROVIDER | ollama (disabled permite mostrar el estado sin proveedor) |
| OLLAMA_BASE_URL | http://127.0.0.1:11434 |
| OLLAMA_MODEL | qwen3.5:4b |
| OLLAMA_NUM_CTX | 8192 |
| PORT | 3000 |
| MAX_ITERATIONS | 25 |
| MAX_SESSION_TOKENS | 120000 |
| MAX_OUTPUT_TOKENS | 1024 |
| LLM_TIMEOUT_MS | 90000 |
| MAX_SESSIONS | 50 |

El servidor y el adaptador están restringidos a loopback; no se autorizan modelos cloud, túneles ni exposición de Ollama. Si el modelo falla o tarda demasiado, el chat muestra error y conserva la sesión. Las sesiones viven en memoria y desaparecen al reiniciar. configured en health indica configuración del adaptador, no garantiza disponibilidad de Ollama.

## Chat y API

El frontend muestra historial, pensando, llamadas con nombre/argumentos/resultado y revisión pendiente resaltada. Confirmar implica un turno humano posterior y un pendingId vigente; el formulario permite aportar valores concretos. El modelo no puede autorizarse con confirmado:true ni sustituir el contrato obtenido de herramientas. El registro vuelve a validar completitud y tipos.

- POST /api/chat: { sessionId?, message, confirmation? }; devuelve sessionId, reply, toolCalls, needsConfirmation y pending.
- GET /api/sessions/:id: historial, revisión pendiente y presupuesto de la sesión.
- GET /api/health: disponibilidad del backend, provider, model y configured; sin secretos.
- GET /: frontend del mismo backend.

Prompt en agent/prompt.md, conocimiento en src/knowledge/registro-contratos.md, ejecución en src/tools/contratos.ts y adaptador desacoplado en src/llm/. Se comprobó /api/tags con qwen3.5:4b y tool calling nativo real: leer_buzon devolvió 0 pendientes tras la demo, y extraer(msg-001) devolvió COP 265000000 y fechas 2026-08-01/2027-07-31, que el modelo reprodujo correctamente. Una llamada tardó 6.538 s y un ciclo de dos llamadas 7.842 s, con 1651 tokens de entrada acumulados y 88 de salida. Son observaciones de una prueba pequeña, no benchmark. Un primer lote real aislado respondió HTTP 200 en 20.457 s con 11 llamadas: leyó seis mensajes, extrajo cinco contratos y validó las clasificaciones esperadas. Se detuvo correctamente ante msg-006, pero no registró los casos limpios porque el modelo acumuló validaciones; por tanto ese ensayo no fue un éxito completo. Se ajustó el prompt para procesar cada mensaje de punta a punta y la repetición real sigue pendiente.

## Entrega y límites

URL pública: **no disponible**. Se prepara defensa local con Ollama; PRD §9.3 admite esa alternativa con penalización de -10 puntos. No se ha publicado ni enviado una entrega.

Excluir node_modules/, dist/, out/, .env y logs conforme .gitignore; sí entregar .env.example sin secretos. Los adjuntos se archivan como TXT reales, no PDF ficticios. Sin OCR, revisión jurídica, multiusuario, autenticación, streaming ni bonus. El parser cubre la familia de TXT entregada, no documentos arbitrarios. CSV y cola de escritura son de un proceso; no sustituyen una base de datos con recuperación ante caída.
