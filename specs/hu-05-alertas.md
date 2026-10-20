# HU-5 — Alertas
Spec previa al bloque. Fuente PRD HU-5, O4, §6.2. Entrada hoy YYYY-MM-DD explícita validada. Salida ruta,vencen,polizas_pendientes,registrados_desde_corte y out/alertas.md con tres secciones. Horizonte adoptado: hoy a hoy+60 días inclusivos, excluye vencidos anteriores. Pólizas requeridas con estado distinto de vigente; corte fecha_registro>=2026-05-30. Actualizaciones conservan fecha de alta, por lo tanto no cuentan como altas nuevas.
Pruebas pendientes: límites0/60/61días, fecha inválida, pólizas/altas, resultado determinista y original intacto. No se inventa fecha de expiración de póliza: solo hay estado en los fixtures.

## Resultado implementado y comprobado
Herramienta genera out/alertas.md y arrays tipados por los datos del maestro, con tres secciones. Test verifica hoy/día60 incluidos y anteriores/día61 excluidos; pólizas pendientes/vencidas y altas desde corte, sin contar actualización como alta nueva. Fecha inválida produce error y conserva reporte anterior. Demo2026-09-03 identifica próximos vencimientosCT-2026-004/CT-2026-009. Suite completa37/37 y typecheck aprobados. No hay fechas de expiración de pólizas inventadas.
