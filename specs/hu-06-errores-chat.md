# HU-6 y arquitectura de chat — bloque previo a implementación

Referencia única de requisitos: PRD HU-6, §6.1–6.4 y §8. Se prepara antes de este bloque; no duplica reglas de negocio.

Implementar API HTTP mínima, sesión en memoria, interfaz propia de proveedor, bucle acotado, validación zod de cada llamada, errores legibles y frontend HTML con historial, pensando, llamadas de herramienta y confirmación resaltada. Prompt y conocimiento se leen de sus archivos exigidos por PRD.

Sin proveedor elegido, el chat informará que falta configuración; no fingirá respuesta de LLM. Fake inyectado únicamente en pruebas, identificado como prueba. Sin credenciales ni llamadas externas en este bloque.

Confirmación protegida por backend: almacenar snapshot de contrato derivado de herramientas, campos pendientes e ID de petición. Ante revisión, terminar turno con pregunta explícita; solo el siguiente turno humano puede confirmar esa petición. Correcciones explícitas limitadas a campos de contrato, sin modificar confianza desde el modelo. Revalidar antes de registrar. Un confirmado:true del modelo nunca concede autorización y sus datos contractuales no sustituyen snapshots provenientes de herramientas.

Pruebas previstas: llamada válida visible, argumentos inválidos legibles, proveedor fallido/timeout recuperable, iteraciones y presupuesto acotados, modelo intentando registrar sin confirmación bloqueado, confirmación ligada al siguiente turno y snapshot, correcciones rechazadas si invaden campos internos. API health no expone claves. Un error no destruye la sesión.

Supuestos de implementación: confirmación mediante formulario estructurado en el chat o confirmo explícito del snapshot; los datos faltantes deben aportarse por el formulario. Límites también en cantidad de sesiones para evitar presupuesto ilimitado recreando sesiones. El conteo local conservador de tokens es estimación/barrera; proveedor debe respetar maxOutputTokens y reportar consumo cuando exista integración real.

Estado inicial: pendiente de implementación y pruebas. Integración LLM real y despliegue fuera de esta verificación hasta definir proveedor.

## Actualización verificada del bloque

El apartado anterior registra la planificación previa; el proveedor se eligió después: Ollama local, modelo instalado qwen3.5:4b, API HTTP 127.0.0.1:11434. Se implementaron interfaz propia, adaptador nativo de herramientas, servidor HTTP en 127.0.0.1:3000 y chat HTML. No hay despliegue público ni llamada pagada.

La confirmación estructurada está ligada a petición, siguiente turno y snapshot obtenido de herramientas. Solo admite correcciones explícitas de valor, moneda, fechas y póliza; revalida antes de registrar. La aprobación textual acepta únicamente «confirmo» o «sí confirmo», con puntuación opcional: texto como «confirmo valor999» no registra ignorando el cambio propuesto. El modelo no puede aportar aprobado humano ni reemplazar el contrato confiable.

Límites por defecto: 25 iteraciones, 120000 tokens por sesión, salida 1024, timeout 90000ms por llamada, 50 sesiones; contexto Ollama 8192. Antes de llamar se reserva una estimación conservadora basada en bytes de historial y descripción del catálogo más salida; si existe usage positivo se reconcilia con tokens reales de entrada+salida. En timeout, ausencia o cero se conserva la reserva. No equivale a facturación calibrada ni garantiza que el contexto del modelo nunca trunque.

Verificación ejecutada: check y build sin errores; 10/10 pruebas backend, incluidas protección de confirmación, argumentos inválidos, errores/timeout, presupuesto y API HTTP. El coordinador ejecutó la suite completa: 40/40, cero fallos. Los dobles de proveedor están identificados como fake_solo_pruebas; no demuestran el comportamiento del modelo real. Health y HTML reales devolvieron HTTP200. Pruebas reales unitarias de Ollama llamaron leer_buzon y extraer msg-001 correctamente; extracción real COP265000000 y fechas explícitas. Los lotes reales iniciales detectaron dos límites: acumulación de validaciones y reserva sin reconciliación; se corrigieron prompt y conteo respectivamente. La última ejecución real aislada se informa al terminar, sin presumir éxito de lote por las pruebas automáticas.

Pendientes/limitaciones: sin revisión visual del navegador; sin persistencia de sesiones tras reiniciar; Ollama y servidor accesibles solo en loopback. Crear sesión nueva no restablece out ni procesados. El maestro original y fixtures se conservan; pruebas de registro del chat usan copias aisladas bajo out. SOLUCION.md sigue obligatorio y permanece en raíz. PRD define la aceptación final.

Resultado final del lote real aislado (una última ejecución tras reconciliar usage): 27.632s, consumo informado 51296/120000, HTTP200; registró msg-001 y msg-002 y extrajo msg-003. El modelo devolvió texto final truncado y no continuó llamadas: no llegó a msg-006, confirmación humana ni alertas. No fue parada por presupuesto ni timeout. La copia aislada se retiró al terminar; no se registró ese lote en el out raíz. La prueba demuestra integración y registros parciales reales, no cumplimiento extremo a extremo de los seis mensajes con Ollama. No se repitió después de este resultado.
