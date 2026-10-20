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

Typecheck y build aprobados. Última suite completa: **42 pruebas, 0 fallidas**: 5 HU-1, 15 HU-2, 10 núcleo/demo y 12 backend. Incluye clasificación, otrosí, confianza/revisión, confirmación humana entre turnos, límites, timeout, idempotencia, errores de escritura, CSV, alertas, API y conservación de originales. Las pruebas del ciclo usan un proveedor fake explícito; no son una prueba del lote completo con Ollama.

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
| MAX_OUTPUT_TOKENS | 2048 |
| LLM_TIMEOUT_MS | 90000 |
| MAX_SESSIONS | 50 |

El servidor y el adaptador están restringidos a loopback; no se autorizan modelos cloud, túneles ni exposición de Ollama. Si el modelo falla o tarda demasiado, el chat muestra error y conserva la sesión. Las sesiones viven en memoria y desaparecen al reiniciar. configured en health indica configuración del adaptador, no garantiza disponibilidad de Ollama.

## Chat y API

El frontend muestra historial, pensando, llamadas con nombre/argumentos/resultado y revisión pendiente resaltada. Confirmar implica un turno humano posterior y un pendingId vigente; el formulario permite aportar valores concretos. La confirmación textual solo acepta la frase exacta confirmo o sí confirmo, con puntuación opcional; cambiar campos exige el formulario ligado al snapshot. El modelo no puede autorizarse con confirmado:true ni sustituir el contrato obtenido de herramientas. El registro vuelve a validar completitud y tipos.

- POST /api/chat: { sessionId?, message, confirmation? }; devuelve sessionId, reply, toolCalls, needsConfirmation y pending.
- GET /api/sessions/:id: historial, revisión pendiente y presupuesto de la sesión.
- GET /api/health: disponibilidad del backend, provider, model y configured; sin secretos.
- GET /: frontend del mismo backend.

Prompt en agent/prompt.md, conocimiento en src/knowledge/registro-contratos.md, ejecución en src/tools/contratos.ts y adaptador desacoplado en src/llm/. Se comprobó /api/tags con qwen3.5:4b y tool calling nativo real de leer_buzon y extraer(msg-001), con valor COP 265000000 y fechas correctas.

El último ensayo real de lote en copia aislada duró 54.396 s y siguió siendo **parcial**: se observaron registros de msg-001/002/006, este último mediante una confirmación humana **simulada** de prueba; no quedó verificado el registro del otrosí msg-003. Se crearon alertas, pero el resumen final se detuvo por presupuesto. No equivale al resultado completo de la demo ni demuestra las 11 filas esperadas mediante el chat LLM. Hubo truncamiento con contexto de 8192: dos respuestas reportaron 8006 tokens de entrada +186 de salida y 8040+152, con fin por longitud. Son observaciones de una ejecución, no benchmark ni una tasa de éxito general.

Para defensa local, trabajar por etapas o mensajes concretos y comprobar las acciones de herramienta; usar la demo sin LLM para verificar el núcleo completo. El presupuesto se reconcilia con usage positivo de Ollama; conserva reserva conservadora cuando falta usage o hay timeout. El límite de salida actual del código es 2048, pero ampliarlo no prueba por sí solo que el contexto permita el lote completo.
Corrección posterior: ante una solicitud operativa respondida solo con texto, el ciclo realiza como máximo un reintento guiado para ejecutar herramientas; si vuelve a faltar la acción, devuelve un error explícito. El reintento se verificó con proveedor fake. Un ensayo real nuevo, aislado y solo de lectura, tardó 6.421 s: contratos_leer_buzon({}) devolvió seis mensajes, reconoció msg-005 como rechazado y terminó en dos llamadas al modelo con 5069/40000 tokens; no registró contratos ni ejercitó el reintento real porque llamó la herramienta a la primera. Evidencia: out/ollama-lista-evidencia-ISHVd8/out/log.jsonl. Esta lectura no acredita el lote completo. La app que el usuario mantiene abierta sigue ejecutando la versión anterior: no se reinició porque perdería sesiones en memoria. Los cambios nuevos aún no se han subido.

## Entrega y límites

URL pública: **no disponible**. Se prepara defensa local con Ollama; PRD §9.3 admite esa alternativa con penalización de -10 puntos. No se ha publicado ni enviado una entrega.

Excluir node_modules/, dist/, out/, .env y logs conforme .gitignore; sí entregar .env.example sin secretos. Los adjuntos se archivan como TXT reales, no PDF ficticios. Sin OCR, revisión jurídica, multiusuario, autenticación, streaming ni bonus. El parser cubre la familia de TXT entregada, no documentos arbitrarios. CSV y cola de escritura son de un proceso; no sustituyen una base de datos con recuperación ante caída.
