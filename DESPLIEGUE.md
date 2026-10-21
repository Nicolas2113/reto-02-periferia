# Versión web: preparación local, todavía sin publicar

Rama `web-version`, basada en main `4394509`. Esta guía describe la adaptación implementada; no acredita un despliegue ni una conexión real. No se han creado servicios ni configurado claves.

## Qué hace cada parte

- Vercel sirve `web/index.html` y ejecuta `api/index.ts` por petición. No mantiene un proceso Node escuchando ni conserva las sesiones en memoria entre llamadas.
- Gemini propone llamadas nativas a las mismas herramientas. El backend conserva la validación, los cálculos y la aprobación humana. El modelo no puede aprobar un contrato.
- Upstash Redis conserva el estado de cada visitante: sesiones, formulario pendiente, maestro, procesados y artefactos ficticios. `/tmp` sirve solo para ejecutar un turno; nunca se considera persistencia.

El arranque local `npm.cmd run dev` mantiene Ollama y los archivos locales. Las variables cloud no cambian ese modo. `demo.ts` sigue sin usar modelo; no ejecutar la demo sobre el `out/` que se quiera conservar.

## Guardado y aislamiento

El código de acceso compartido de la demo se valida en backend. Una cookie firmada, HttpOnly, Secure y SameSite=Strict identifica un espacio separado por visitante. No es autenticación corporativa ni autorización por roles. Hay hasta cinco conversaciones por visitante, pero comparten su propio buzón: Nueva sesión no reinicia registros.

Cada turno usa copia temporal de fixtures y salida recuperada. El guardado Redis incluye estado y archivos en un único snapshot con comparación de versión y dueño de bloqueo mediante Lua. Solo se responde con éxito después de confirmar el guardado. Otro turno simultáneo recibe conflicto; un worker cuyo lease expiró no puede guardar encima de otro. Ante respuesta de red incierta, el navegador conserva `x-request-id` y ofrece reintentar exactamente el mismo cuerpo. Los últimos cuatro resultados se conservan; IDs anteriores ya usados no se vuelven a ejecutar y se consulta el estado. Son hasta cien turnos por visitante.

La confirmación lleva el ID pendiente del backend y valores humanos del formulario; se revalida al registrar. No se acepta un estado completo ni `confirmado:true` del modelo o cliente como sustituto. Las firmas opacas de Gemini se conservan internamente al reproducir llamadas nativas; nunca se muestran en el chat.

La cookie dura dos horas absolutas. Redis tiene TTL de dos horas desde el último commit; al expirar, ingresar otra vez con código crea una nueva demo ficticia. No es un archivo permanente ni conserva resultados indefinidamente. No importar aquí contratos reales. El registro de auditoría pertenece a los artefactos aislados y también expira. Exportar antes si se necesitan evidencias.

## Variables: solo cuando se autorice conectar

En Vercel, backend únicamente; `.env.example` contiene marcadores deliberadamente inválidos. Nunca claves en Git, frontend ni chat.

| Variable | Uso |
|---|---|
| APP_ORIGIN | Origen HTTPS exacto, sin barra final, ruta ni query; debe coincidir con Host y Origin del navegador. Un preview de otro host requiere su configuración propia. |
| GEMINI_MODEL | Candidato `gemini-3.8-flash`; alternativa explícita permitida `gemini-3.5-flash-lite`. No hay fallback automático. |
| GEMINI_API_KEY | Clave backend; no se ha leído, configurado ni usado. |
| UPSTASH_REDIS_REST_URL / TOKEN | Endpoint HTTPS oficial `*.upstash.io` y token REST del almacén Free, solo backend. |
| DEMO_ACCESS_CODE | Código secreto aleatorio de al menos 32 caracteres, compartido únicamente con quien probará. |
| DEMO_COOKIE_SECRET | Otro secreto aleatorio independiente, mínimo 32 caracteres. Cambiarlo invalida cookies anteriores. |
| DEMO_NAMESPACE | Nombre propio por entorno. No compartir entre producción y previews. |
| DEMO_MODEL_CALLS_DAY | Reserva global: 60 llamadas/día UTC por defecto, máximo 100. |
| DEMO_MODEL_TOKENS_DAY | Reserva conservadora: 2.000.000 por defecto, máximo 3.000.000. Cuenta bytes de contexto + salida + margen; no es facturación calibrada. |
| DEMO_MODEL_RPM | Por defecto 1 llamada/minuto global. Ajustar solo tras verificar cuota gratuita real; máximo 60. |

El límite inicial de 1 RPM puede pausar el lote después de una etapa: esperar un minuto y enviar `Continúa` conserva el trabajo confirmado. No se promete completar un lote en un solo turno con ese cupo. Las pruebas usan cuota ficticia suficiente; no demuestran cuota de la cuenta. Además: 50 turnos de chat/día, 100 accesos/día, 10 intentos de acceso/minuto, 30 lecturas/minuto/visitante; entradas 16 KB, snapshots 900 KB, artefactos 40 archivos/256 KB. Al agotarse un límite, se detiene; no se compra capacidad ni se cambia a un modelo de pago.

Deadline de aplicación 100 s, timeout de una llamada 15 s, función declarada 120 s y lease 150 s. Si hay timeout/cuota, el lote queda pendiente; volver a intentar no equivale a aprobar un contrato. Los errores del proveedor se sanean: no se publican cuerpos ni headers. No hay reintentos automáticos de Gemini que multipliquen llamadas.

## Verificación completada localmente

- `npm.cmd run check`: sin errores.
- `npm.cmd test`: 69/69, incluyendo build. Las 57 pruebas anteriores siguen pasando.
- Backend cloud con dobles explícitos de modelo/Redis: nuevo motor por petición, recuperación de formulario, cinco cierres/10 filas antes de revisión y seis/11 tras datos humanos ficticios, alertas finales, aislamiento, confirmación vieja/forjada, CAS/lease, commit ambiguo y replay, fallo de persistencia, cuota y estado corrupto.
- Adaptador con HTTP simulado: function calling, schema zod, continuidad opaca, usage y errores de cuota/seguridad. No usa una clave real.
- DOM simulado: reintento conserva ID/cuerpo y no duplica el mensaje. Se mantienen pruebas de Markdown/XSS.
- Paquete offline: copia de entrada compilada, dependencias y assets carga fuera del proyecto sin `.env` ni `out/`. Revisión de configuración/archivos Vercel. Esto no sustituye al builder ni a un despliegue Vercel real.
- 24 hashes de PRD, fixtures y out local conservados. No se ejecutó demo sobre la salida del usuario. Main permanece en `4394509125cdbb27629aae16cdddde4bfffe8f39`.

No hubo navegador disponible: comprobación de DOM/API lógica, sin validación visual cloud. Ninguna llamada real Gemini/Upstash ni publicación. La prueba Lua es un doble de su contrato, no ejecución contra Redis real. No se garantiza disponibilidad efectiva del ID de modelo, su cuota, latencia ni funcionamiento completo real todavía.

## Próxima fase, aún no iniciada

Con aprobación: verificar planes Free sin facturación y cuota/modelo exactos; crear/conectar servicios; guardar secretos desde sus paneles; configurar origen y namespace propios; construir con Vercel y probar una consulta mínima real, una llamada a herramienta y recuperación después de cold start; después completar los seis casos, revisión humana y exports desde URL pública. No publicar antes de esas comprobaciones ni afirmar que ya hay enlace operativo.

Referencias oficiales: [Vercel runtime](https://vercel.com/docs/functions/runtimes), [duración](https://vercel.com/docs/functions/configuring-functions/duration), [Hobby](https://vercel.com/docs/plans/hobby), [Gemini precios](https://ai.google.dev/gemini-api/docs/pricing), [cuotas](https://ai.google.dev/gemini-api/docs/rate-limits), [function calling](https://ai.google.dev/gemini-api/docs/function-calling), [continuidad](https://ai.google.dev/gemini-api/docs/thinking), [Upstash planes](https://upstash.com/pricing/redis). La gratuidad depende del plan/cuota del usuario; la aplicación no habilita facturación. Solo datos ficticios, pues las condiciones del nivel gratuito de Gemini permiten uso del contenido para mejorar productos.
## Valores de importación Vercel para esta rama

- Repositorio: Nicolas2113/reto-02-periferia.
- Rama a desplegar: web-version; mantener main intacta. Verificar que el deployment use esta rama, pues importar el repositorio puede elegir main por defecto.
- Root Directory: raíz del repositorio (`.`).
- Framework Preset: Other (sin framework).
- Install Command: npm ci (dependencias de desarrollo necesarias para TypeScript durante build).
- Build Command: npm run build.
- Output Directory: web.
- Función Node: api/index.ts; duración máxima declarada 120 segundos.
- Variables obligatorias backend: APP_ORIGIN, GEMINI_MODEL, GEMINI_API_KEY, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, DEMO_ACCESS_CODE, DEMO_COOKIE_SECRET, DEMO_NAMESPACE. Límites opcionales: DEMO_MODEL_CALLS_DAY, DEMO_MODEL_TOKENS_DAY, DEMO_MODEL_RPM. No incluir variables Ollama para la función cloud.

Other está documentado por Vercel como ausencia de framework: https://vercel.com/docs/project-configuration/vercel-json. Estos valores son instrucciones de configuración, no evidencia de un build/despliegue real. No crear ni conectar servicios como efecto de este commit.