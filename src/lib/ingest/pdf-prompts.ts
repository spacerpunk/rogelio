// Prompts internos para leer PDFs con el motor de texto (fuentes y guiones subidos en PDF).

export const PDF_SYSTEM =
  "Transcribís documentos de capacitación para una productora de video. Tu salida es la materia prima con la que después se escribe un guion, así que tiene que ser fiel y completa.";

export const PDF_INSTRUCTIONS = `Extraé el contenido completo de este documento en Markdown, en el orden original.

- Usá "## Página N" como encabezado de cada página (o "## Diapositiva N" si es una presentación exportada).
- Transcribí todo el texto relevante: títulos, viñetas, pasos, advertencias, tablas (como tablas Markdown) y notas importantes. No resumas ni omitas pasos de procedimientos.
- Describí brevemente entre corchetes las fotos, diagramas e ilustraciones que aportan información. Ejemplo: [Foto: operario con guantes de cuero ajustando una válvula roja].
- Ignorá encabezados y pies de página repetidos, números de página y logos.
- Devolvé solo el contenido, sin comentarios antes ni después.`;

// Guion existente subido en PDF: transcripción textual, sin reescribir.
export const SCRIPT_PDF_SYSTEM =
  "Transcribís guiones de videos de capacitación. La transcripción se usa tal cual como guion del video, así que tiene que ser textual y completa.";

export const SCRIPT_PDF_INSTRUCTIONS = `Transcribí este guion completo en Markdown, en el orden original.

- Copiá el texto palabra por palabra: locuciones, diálogos, indicaciones visuales, títulos de escena, tiempos y notas. No resumas, no corrijas ni reescribas.
- Conservá la estructura: escenas o secuencias como encabezados, y los guiones a dos columnas (video / audio) como tablas Markdown.
- Ignorá encabezados y pies de página repetidos, números de página y logos.
- Devolvé solo el guion, sin comentarios antes ni después.`;
