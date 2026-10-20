# Guía para asistentes de programación

- PRD.md es la única fuente de requisitos. Léelo antes de cambiar código; no modifiques PRD.md ni fixtures/. Consulta allí las reglas de negocio, arquitectura y aceptación.
- Sigue la estructura del PRD §6.5 y su separación: comportamiento en agent/prompt.md, conocimiento en src/knowledge/, ejecución en src/tools/ y proveedor desacoplado en src/llm/.
- Trabaja por bloques pequeños y explicables. Relaciona tareas y pruebas con secciones del PRD; explica qué cambiaste, por qué y cómo lo verificaste. Documenta decisiones, ambigüedades y resultados en specs/ por historia, sin duplicar requisitos del PRD. SOLUCION.md debe permanecer en la raíz como documento obligatorio del PRD §9.1 y completarse antes de entregar.
- Evita duplicar el PRD o crear especificaciones generales alternativas; las specs breves por HU están autorizadas como trazabilidad técnica y de pruebas. No se requiere mantener TAREAS.md. Evita constituciones y archivos alternativos de instrucciones. Añade solo lo necesario; preserva trabajo ajeno y no adelantes fases que el usuario haya pausado.
- Usa TypeScript estricto, sin any, y zod según el contrato del PRD §6.2. Mantén las herramientas independientes del servidor e importables por demo.ts.
- No inventes datos ausentes ni confianza precisa sin fundamento. Explica las heurísticas. Una confirmación generada por el modelo no es aprobación humana: respeta el siguiente turno del usuario según CA3.
- Mantén secretos exclusivamente en variables de entorno del backend; nunca en frontend, respuestas API, logs ni Git. No leas, publiques ni registres credenciales. Las herramientas no ejecutan shell.
- Ejecuta las pruebas pertinentes antes de afirmar éxito; informa qué pasó, qué no se verificó y qué queda pendiente. Declara el uso real de asistentes IA y sus tareas en SOLUCION.md (§9.1).
- Estado inicial: solo estructura y marcadores, sin aplicación ni demo funcional. No presentes comandos de package.json, pruebas, proveedor o despliegue como operativos hasta implementarlos y verificarlos.
