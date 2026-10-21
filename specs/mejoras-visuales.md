# Presentación segura del reporte en chat
Spec previa al código, rama feat/mejoras-visuales desde main2d3cc23. PRD.md sigue como fuente de requisitos: HU5 (reporte de alertas), HU6 y §6.1/§6.3 (chat, trazas y revisión humana). Mejora visual solicitada después de completar manualmente el flujo.

Alcance: representar encabezados, párrafos, listas y tablas del texto del asistente con jerarquía, espaciado y tablas adaptables. Conservar datos, fechas, advertencias y estados literales. No cambiar reporte exportado, reglas, herramientas, sesiones ni confirmaciones. Mensajes del usuario y trazas continúan como texto.

Seguridad: parser acotado sin HTML confiable, dependencias, enlaces activos ni inserción innerHTML; construir nodos y asignar texto. HTML, SVG, eventos, URLs javascript y similares se muestran como texto inerte. Formato no soportado conserva texto. Evitar superposición del compositor con el reporte mediante flujo normal del documento y scroll horizontal local en tablas.

Aceptación: reporte simulado conserva fechas42/27días y advertencias; tabla de seis mensajes con estados literales legibles; encabezados/listas/párrafos formateados; mensajes del usuario no interpretados; payloads maliciosos no crean elementos/atributos ejecutables; formulario y trazas conservados. Tests aislados, check/build/suite y revisión visual solo si navegador disponible. No consumir buzón ni modificar out, PRD o fixtures.

Estado inicial: main limpio y rama nueva creada. Inventario CUA sin aplicaciones ni navegadores; no se promete captura ni comprobación visual. Resultados pendientes.
## Implementado y verificado
- web/index.html: parser de subconjunto Markdown mediante createElement/createTextNode/textContent. Encabezados, párrafos, listas ordenadas/no ordenadas, tablas, negrita y código; estados literales con estilo. No inserta HTML ni activa enlaces/imágenes. Texto de usuario y detalles de herramientas continúan literales. Formato no soportado o tabla irregular conserva su texto.
- Jerarquía y espaciado del reporte, tablas con desplazamiento horizontal propio y foco accesible, estilos móviles. Compositor en flujo normal, sin superponer el reporte. Sin cambios en API, herramientas, confirmación, exportación ni contenido del reporte.
- tests/presentacion.test.ts: cinco pruebas aisladas de DOM simulado: estructura/fidelidad; pipes y código en tablas; payloads HTML/SVG/script/iframe/eventos/javascript; usuario y trazas literales; formato incompleto/código inerte. package.json solo añade esa prueba al comando existente. Sin dependencias nuevas.
- npm.cmd run check y build correctos; suite57/57,0 fallos,3.173s. Incluye las52 regresiones existentes. No hubo llamadas LLM ni procesamiento/reset de contratos. HTTP GET / devolvió200 y el hash del HTML servido coincide con la nueva interfaz; no se reinició el servidor.
- Inventario CUA: apps[] y browsers[]. No hubo inspección visual ni captura; no se afirma una prueba real de layout responsive. Se preparó fuera del repositorio preview-mejoras-visuales.html con datos simulados y el mismo renderizador/estilos, sin conexión ni acciones, para revisión humana.
- Para ver la mejora: recargar http://127.0.0.1:3000 y consultar de nuevo el reporte; los mensajes ya pintados en una página anterior no se reformatean solos. Esto no reinicia datos. Alternativa: abrir la vista aislada fuera del repositorio sin usar el modelo.

El usuario aprobó visualmente y autorizó subir esta rama sin integrarla a main. La revisión del agente sigue limitada a DOM simulado y HTML servido; no hay captura automatizada. Main conserva su referencia original. README/SOLUCION no se modificaron.
Conservación final: 24 hashes de PRD/fixtures/out comparados; 0 cambios. Revisión del diff sin modificaciones de backend, reglas ni confirmación.
