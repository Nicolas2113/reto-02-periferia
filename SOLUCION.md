# Solución — Registro de Contratos Vigentes

PRD.md es la fuente única de requisitos. Estado verificado: typecheck/build aprobados y 41 pruebas aprobadas (5 HU-1, 15 HU-2, 10 núcleo/demo, 11 backend). Demo completa comprobada; backend/chat probados con fake, arranque npm start real y dos herramientas invocadas nativamente desde Ollama. El lote completo LLM y despliegue público no están verificados. specs/ conserva trazabilidad por historia.

## 1. Problema y usuario

La analista administrativa necesita un registro confiable de todos los contratos recibidos, con y sin póliza, que sobreviva a la rotación de personal y permita a gerencia anticipar vencimientos.

## 2. Arquitectura

```text
Chat web → API/sesión → ciclo del agente → adaptador LLM
                          ↓ llamadas tipadas zod
                    src/tools/contratos.ts
                          ↓
        fixtures/ (solo lectura) → out/ (resultados)
```

Comportamiento en agent/prompt.md; conocimiento en src/knowledge/registro-contratos.md; ejecución en herramientas separadas e importables por demo.ts. La extracción determinista vive en src/extraccion.ts. El proveedor se desacopla mediante src/llm/adapter.ts. Node HTTP y HTML sencillo evitan dependencias de un framework. La API HTTP y el frontend pasaron prueba integrada con proveedor fake; npm start real respondió HTTP 200 en health y HTML. El lote completo con Ollama todavía no está verificado; no hubo inspección visual en navegador.

## 3. Ciclo del agente

El backend mantiene sesiones e historial en memoria, envía mensajes y esquemas de herramientas al adaptador, valida cada llamada con zod, ejecuta y devuelve resultados hasta una respuesta o un límite. Valores configurables: 25 iteraciones, 120000 tokens por sesión, 2048 de salida por llamada, timeout de 90000 ms y máximo 50 sesiones por defecto. Las pruebas comprueban límites, timeout y continuidad tras errores; usage positivo de Ollama reconcilia el consumo, conservando reserva si no hay usage o hay timeout. La confirmación textual solo acepta confirmo/sí confirmo exactos con puntuación opcional; los cambios de campos requieren formulario ligado al pendingId, snapshot y siguiente turno. El chat muestra nombre, argumentos y resultado de las llamadas.

La revisión pendiente queda vinculada a sesión, snapshot del contrato, ID y turno: el agente termina preguntando y el backend solo permite registrar después de un turno humano posterior. El formulario envía pendingId, approved y corrections limitadas a campos de negocio. Una petición antigua o campos internos no autorizan; un confirmado:true del modelo no basta ni permite sustituir el snapshot. Registrar vuelve a validar tipos, completitud y confianza desde la evidencia: no se evita revisión elevando la confianza suministrada por el modelo. Estas defensas pasaron las pruebas del backend y del núcleo.

## 4. Elección del modelo y costo

Nicolás eligió Ollama local para evitar credenciales y consumo de una API externa. Backend y Ollama solo en loopback, sin túnel ni publicación. /api/tags confirmó qwen3.5:4b; lectura y extracción nativas se comprobaron con valores exactos de msg-001. El adaptador propio permite cambiar proveedor sin reescribir el ciclo.

Los ensayos reales de lote no equivalen a aceptación completa. El último, en copia aislada, duró 54.396 s: se observaron registros de msg-001/002/006 (confirmación humana simulada para msg-006), pero no quedó verificado el registro del otrosí msg-003. Las alertas se crearon y el resumen final falló por presupuesto. No se atribuye al chat el resultado completo de 11 filas de la demo. Hubo dos respuestas truncadas por longitud con contexto 8192: 8006 tokens de entrada +186 de salida y 8040+152. No son benchmark ni rendimiento estable. El límite de salida actual del código es 2048; no resuelve por sí solo un contexto lleno. Para defensa local, usar solicitudes por etapas o mensajes concretos con comprobación de cada resultado, y la demo determinista para validar todo el núcleo. No se verificó aquí la versión exacta del servicio Ollama.
Costo por consulta de API externa: 0 en esta ruta local. No equivale a costo total cero: hardware, electricidad y tiempo de inferencia no se han medido. Hay mediciones puntuales de latencia/tokens de la prueba descrita, no una estimación representativa por contrato ni un benchmark general. La demo determinista no consume LLM. Si se adopta otra API después, documentar modelo, fecha, tarifas oficiales y estimación por tokens, distinguiéndola del consumo observado. Las pruebas fake son pruebas de control del ciclo, no evidencia de funcionamiento real del modelo.
## 5. Estrategia de extracción y confianza

Regex y heurísticas leen las cláusulas TXT de los fixtures y normalizan monto, moneda, NIT/RUC y fechas; no OCR ni LLM para extraer. Cada campo incluye evidencia y confianza ordinal no calibrada: literal 0.9, inferencia simple 0.8, fecha derivada 0.7, representación de valor por demanda 0.5 y ausencia 0. No son probabilidades de acierto.

Ausentes son null/0. El otrosí no hereda objeto/inicio durante extracción: combinarlo con el maestro pertenece a validación/registro. Se conserva texto completo del objeto en evidencia si se recorta a 200 caracteres. El plazo no determina fechas sin un inicio completo. En msg-006 el valor es 0 por demanda; COP 100 millones corresponde a la condición de garantía, no al importe/moneda del contrato. La aplicabilidad global de la póliza y fechas completas quedan para aclaración humana. El modelo puede orientar el flujo, pero no ser fuente independiente de valores registrados.

## 6. Regla de gobierno propuesta (una página)

Propuesta ficticia para aprobación organizativa; no política real ni correo configurado. Canal único: contratos@periferia-ficticia.com, administrado por la analista administrativa con un suplente designado por gerencia. La analista es dueña operativa del maestro; dudas jurídicas se escalan al responsable comercial y a asesoría externa designada, sin atribuir revisión jurídica al agente.

Todo comercial envía PDF firmado, otrosíes y actas de terminación dentro de dos días hábiles de cada firma, aunque no exista póliza. Asunto: [CONTRATO|OTROSI|TERMINACION] ID — NIT/RUC — cliente. Adjunta el documento completo e identifica comercial responsable y condición de póliza. Sin envío completo no se considera cerrado el trámite administrativo; gerencia recibe excepciones pendientes al siguiente día hábil.

Acuse propuesto en máximo 15 minutos desde recepción: ID del mensaje, recibido/no registrado, clasificación preliminar y campos/documentos pendientes. La analista resuelve o asigna la revisión en un día hábil. Este prototipo no envía acuses reales. Un documento sin firma se recibe como pendiente documental y no se registra como firmado; sin valor, se distingue valor por demanda documentado de omisión. No se inventan cifras/fechas: se pide confirmación al comercial y a la analista. A los dos días hábiles sin respuesta se escala al líder comercial; riesgos de póliza se escalan además a gerencia y corredor, con responsable y fecha compromiso.

Para cerrar junio–agosto de 2026 se propone una campaña única de diez días hábiles: gerencia solicita inventario por comercial; administración cruza facturación y carpetas con el maestro; cada responsable entrega faltantes por el mismo buzón; se validan duplicados/otrosíes y se publica un cierre con faltantes, responsables y excepciones. Se diseña aquí, no se ejecuta en la demo.

Indicador mensual: contratos facturados del mes presentes y verificables en el maestro / total de contratos facturados del mes ×100. Administración publica el resultado y una lista de excepciones con dueño; gerencia fija la meta y revisa acciones. Complemento operativo: edad máxima de pendientes documentales para evitar que el acuse se confunda con registro.

## 7. Decisiones y alternativas descartadas

1. Extracción determinista con evidencia frente a extracción libre por LLM: permite demo sin clave y evita que el modelo invente/redondee valores. Se limita cobertura documental en vez de prometer generalidad.
2. CSV/carpetas locales frente a base de datos/Exchange/SharePoint reales: cumple el alcance simulado y reduce preparación; no ofrece transacciones distribuidas ni escalabilidad de producción.
3. Chat HTML/Node HTTP frente a un framework frontend/backend completo: prioriza herramientas visibles y confirmación verificable en el tiempo disponible; deja diseño visual, autenticación y multiusuario fuera.
4. Prompt, conocimiento y herramientas separados frente a reglas embebidas en el servidor: facilita explicar y cambiar reglas sin acoplar proveedor/HTTP. El adaptador se verifica por separado de la extracción.
5. Se descartó una segunda SPEC general que repetía el PRD; se usan specs breves por HU y resultados reales. Los borradores propios previos se conservaron fuera del proyecto.

Dependencias locales justificadas: zod 3.25.76 para argumentos/datos, TypeScript 5.9.3 para tipos estrictos y @types/node 24.10.0 para API estándar; versiones exactas en lockfile. Sin herramientas globales nuevas.

## 8. Supuestos y ambigüedades

- Adjuntos disponibles son TXT: se archiva su extensión real, sin fabricar PDF. El parser reconoce formatos de la familia entregada; no revisión jurídica universal.
- Una actualización combina parche del otrosí con el maestro, conserva campos no modificados y fecha_registro original; historial identifica el cambio. La prueba de demo comprobó PEN 520000 y fin 2027-11-01 con el resto preservado.
- «Duplicado sin escritura» significa sin modificación de maestro, archivo contractual ni historial contractual; bitácora y procesados pueden registrar su tratamiento para idempotencia.
- HU-3 distingue metadatos operativos y ausencias esperables del otrosí de los campos de negocio que requieren revisión; remitente desconocido se advierte sin bloquear. Los seis casos de clasificación pasaron la prueba.
- Próximos vencimientos: días 0–60 inclusivos, excluyendo ya vencidos. No hay fecha de expiración de pólizas en el esquema; solo se informa su estado.
- La demo declara como humanos simulados los valores de msg-006: valor 0, moneda COP, inicio 2026-08-31, fin 2027-08-31, póliza requerida true y tipo cumplimiento. No se atribuyen al documento ni se consideran verificados por una persona real. Registrar rechaza incluso confirmado:true si faltan datos obligatorios o son inválidos.
- El PRD anuncia rúbrica detallada en §10, pero esa sección contiene riesgos/preguntas; no hay ponderaciones para calcular una nota exacta.

## 9. Cobertura y validación

| Historia/componente | Estado comprobado | Falta para producción/aceptación final |
|---|---|---|
| HU-1 leer buzón | Hecho, 5 pruebas | Buzón real y adjuntos no TXT. |
| HU-2 extracción | Hecho, 15 pruebas | Corpus diverso, OCR y calibración de heurísticas. |
| HU-3 validar | Hecho en los seis fixtures | Similitud Jaccard de palabras con umbral ≥0.9: ampliar corpus y revisar falsos positivos. |
| HU-4 registrar | Hecho en demo/pruebas | Cola de escritura de un proceso y reemplazos por archivo con rollback; no resistente a una caída entre archivos ni a múltiples procesos. |
| HU-5 alertas | Hecho, límites 0/60 y corte probados | Fechas/estados de pólizas reales e integración con responsables. |
| HU-6 y chat/agente | Errores, límites, timeout, confirmación y HTTP probados; 11 pruebas backend | Chat con Ollama parcial por contexto/presupuesto; no aceptación del lote completo ni inspección visual del navegador. |
| demo.ts | Hecho: 10 filas antes, 11 después; repetible salvo timestamps | Confirmación real de datos del contrato marco en uso operativo. |
| LLM local y enlace | Ollama/modelo, herramientas reales y arranque local comprobados; lote parcial, sin URL pública | Operar por etapas y evaluar calidad del modelo. Defensa local implica -10 según §9.3; no se autorizó publicación. |

Evidencia: npm run check y npm test con Node 24.16.0, 41 aprobadas/0 fallidas; build incluido en test. npm run demo procesó los seis casos en orden, aplicó el otrosí, mantuvo msg-006 pendiente en primera pasada y mostró la confirmación simulada explícita. Historial: cuatro acciones contractuales, correspondientes a msg-001/002/003/006. Repetición igual salvo timestamps. Los duplicados/rechazos no modificaron maestro ni historial contractual; procesados aporta idempotencia. CSV escapa comas, comillas y saltos; registro concurrente del mismo mensaje dentro de un proceso genera una sola acción. Un fallo de preflight no dejó maestro/historial parcial. Dos pruebas adicionales comprueban rechazo de maestro/historial corruptos y coincidencia por NIT+objeto/generación de ID AUTO.

Las pruebas mutan copias aisladas dentro de out/ y comprueban hashes de fixtures y bytes del PRD originales. No se declara probado Node 20 exacto, arranque limpio en menos de dos minutos, recuperación ante corte abrupto ni lote completo con modelo real. npm start se ejecutó realmente con health/HTML HTTP 200 en loopback; npm run dev combina build y el mismo arranque, sin medición separada. No se inspeccionó el chat visualmente en navegador.
## 10. Uso de IA

ChatGPT/Codex asistió en revisión del entorno, lectura del PRD, extracción de requisitos, implementación, pruebas y documentación. Se dividió trabajo en asistentes internos del mismo entorno para núcleo, backend/chat y documentación; Ollama con qwen3.5:4b se eligió para ejecución local y se comprobaron llamadas reales de lectura/extracción; no se hizo una llamada pagada ni se leyó una clave. El desarrollo asistido y el modelo local de la aplicación son roles distintos. Las specs de HU-1 documentan retrospectivamente lo realizado; HU-2 se especificó antes de implementarse.

Se descartaron: duplicar el PRD como una segunda especificación general; completar fechas de msg-006 con el correo o una fecha supuesta; tratar el umbral de garantía como valor contractual; y presentar una prueba fake como conexión real al LLM. Nicolás debe revisar, entender y poder defender cada línea. El registro se actualiza con las tareas realmente realizadas, no con una afirmación de autoría exclusivamente humana.

## 11. Riesgos de producción y mitigación

Formatos no cubiertos pueden producir ausencia o interpretación incorrecta: ampliar corpus, revisar umbrales y exigir revisión humana con evidencia. Colisiones/escrituras concurrentes o fallos a mitad de operación requieren control transaccional, bloqueo, backup y recuperación; la cobertura real se debe comprobar. Contenido malicioso del contrato no debe autorizar herramientas: prompt como defensa adicional y controles de backend como barrera de escritura.

Un enlace público con clave de proveedor puede generar abuso: límites por sesión, timeout, cuotas y control de acceso antes de producción. Logs y exportaciones requieren retención, minimización y controles de acceso; el prototipo utiliza datos ficticios. La política de recepción necesita dueño y seguimiento: sin adopción del comercial el agente solo registra lo que llega. No se certifica producción con la demo ni con pruebas locales.
