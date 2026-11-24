# Pendientes: Frameproof

Revisado el 23-nov-2026.

## Estado comprobado
- CI en verde: typecheck, 22 tests unitarios, 4 de punta a punta (Chromium real) y publicación del informe de ejemplo.
- Informe de ejemplo publicado en https://nuvia-ortiz.github.io/frameproof/ (200).
- La página comparada consigo misma da 100 % y ningún fallo; los siete fallos puestos a propósito en `examples/landing/build.html` salen todos.
- Añadido a Proyectos del portfolio (inglés y español) con botón de demo.

## Lo que falta
1. **Probarlo con un archivo real de Figma.** La conexión con la API de Figma está cubierta con respuestas simuladas; falta una pasada con un token personal y un frame propio.
2. Opcional: varios frames en una sola ejecución (escritorio, tablet, móvil) con un archivo de configuración.
3. Opcional: publicarlo en npm para usarlo con `npx frameproof` (necesita cuenta de npm).

## Diseño en Figma
- Archivo público de solo lectura con las pantallas reales como capas editables (24-nov-2026): https://www.figma.com/design/W7sici9lPeKEN3xxYpcUQP/Frameproof-Diseno-del-informe
- Enlazado en el README y en la web portfolio.
