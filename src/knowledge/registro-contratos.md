# Registro de contratos: conocimiento operativo

Referencia: PRD.md §§1–5 y 7. Este archivo explica el proceso; no sustituye los requisitos ni contiene código de ejecución.

La analista administrativa es la usuaria principal y dueña operativa del maestro; gerencia consume alertas. El comercial envía contratos con o sin póliza al canal único. Exchange y SharePoint están simulados con fixtures y carpetas: no hay envío real de correo ni revisión jurídica.

## Secuencia y revisión

Leer pendientes → extraer TXT → validar frente al maestro → registrar/archivar si corresponde → alertar. Un error se informa por mensaje y no aborta el lote (HU-6). Los fixtures son inmutables; los resultados se escriben en out/.

Las reglas RN1–RN5 del PRD gobiernan la clasificación: mismo ID/valor/inicio/fin identifica duplicado; coincidencia de ID, o NIT+objeto con similitud ≥0.9, y cambio identifica actualización; un otrosí es un parche, no un contrato completo nuevo. Sin coincidencia es nuevo; sin contrato o sin partes/objeto identificables corresponde rechazo con motivo. No deduplicar solo por nombre comercial del cliente.

Campos contractuales de confianza <0.8 o conflictos exigen revisión. Las ausencias esperables de un otrosí se conservan desde el maestro durante validación/registro, dejando procedencia; no se fabrican en extracción. Los metadatos de registro no son campos textuales dudosos. Remitente desconocido se informa, pero no bloquea por sí solo.

El contrato marco tiene valor por demanda y garantía condicionada a órdenes que superen un umbral. No confundir ese umbral con el valor total. Sin día de firma no se calcula una fecha de inicio/final exacta; la persona debe aclararla. La confirmación humana corresponde a un turno posterior y a valores concretos, y no reemplaza la validación de tipos/consistencia.

## Registro y trazabilidad

RN6: el maestro original se copia a out/sharepoint/ antes de escribir. Se guarda el adjunto real bajo Contratos/<año_inicio>/<cliente-slug>/<id_contrato>.<ext>; los fixtures actuales son TXT, no PDF generados. Un alta con póliza comienza pendiente; sin póliza, no_aplica. Una actualización conserva la fila y el historial de cambios; se conserva fecha_registro original y se registra la modificación en historial.

RN1 «sin escritura» se interpreta como no cambiar maestro, archivo contractual ni historial contractual por un duplicado; log y estado de procesamiento evitan repetirlo. Cada herramienta deja bitácora conforme RN7. Un rechazo no debe insertarse como contrato válido.

## Alertas

Usar hoy explícito para reproducibilidad. El horizonte operativo documentado son los próximos 0–60 días, inclusive; no incluye contratos ya vencidos. Separar contratos con póliza requerida cuyo estado no es vigente y contratos registrados desde el corte 2026-05-30. Los datos permiten consultar estado de póliza, no calcular vencimiento de pólizas sin su fecha específica.

## Gobierno propuesto

La política organizativa propuesta está en SOLUCION.md §6: canal/owner, obligación de envío, acuse, excepciones/escalamiento, campaña de recuperación junio–agosto e indicador mensual. Es documentación propuesta; esta aplicación no envía acuses ni ejecuta esa campaña.
