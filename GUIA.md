# Guía de Roger That Studio

Cómo hacer correr la app y cómo funciona, de punta a punta.

Roger That Studio convierte el material de un cliente (un PDF, una presentación, un Word o texto pegado)
en un video de capacitación, en etapas: **fuentes → guion → shot list → frames**. Cada etapa la hace una IA
y termina en un punto de aprobación tuyo: nada avanza sin que lo revises.

Esta versión es la **fase 1**: llega hasta los frames (las imágenes fijas de cada plano). La voz en off,
los clips de video y el armado del timeline son las fases 2 y 3.

---

## 1. Cómo hacerla correr

### Qué necesitás

- **Node.js 24** o más nuevo.
- **Docker Desktop** instalado. La base de datos (Supabase) corre adentro de Docker en tu máquina.
- Las **API keys** de los motores que vayas a usar (ver [Claves de API](#claves-de-api)). Sin claves la
  app funciona igual, pero no puede generar nada, salvo en [modo de prueba](#modo-de-prueba-sin-claves).

### La primera vez

1. Instalá las dependencias:

   ```bash
   npm install
   ```

2. Abrí Docker Desktop y esperá a que diga que está corriendo. Después levantá la base:

   ```bash
   npm run db:start
   ```

   La primera vez tarda varios minutos porque baja las imágenes de Docker. Al terminar aplica sola todas
   las migraciones (tablas, permisos, buckets de archivos).

3. Creá el archivo de configuración `.env.local` copiando el de ejemplo:

   ```bash
   cp .env.example .env.local
   ```

   Completá las tres variables de Supabase con lo que muestra este comando (usá `API_URL`, `ANON_KEY`
   y `SERVICE_ROLE_KEY`):

   ```bash
   npm run db:status
   ```

   Después agregá las claves y modelos de los motores (ver abajo).

4. Cargá el cliente Clear Petroleum con su biblioteca:

   ```bash
   npm run seed
   ```

   Crea el cliente, sus textos (style bible, system prompts, negativo), los 12 personajes con sus
   character sheets y 4 locaciones, a partir de la carpeta `seed/clear/`. Podés correrlo las veces que
   quieras: solo completa lo que falta y nunca pisa lo que editaste.

5. Arrancá la app:

   ```bash
   npm run dev
   ```

   Esto levanta **dos procesos**: la web y el **worker** (el que ejecuta los trabajos largos con la IA).
   En la consola los vas a ver como `[web]` y `[worker]`. Abrí http://localhost:3000.

### El día a día

1. Abrí Docker Desktop.
2. `npm run db:start` (si ya estaba corriendo, no hace nada).
3. `npm run dev`.

Para cerrar: `Ctrl+C` en la consola de `npm run dev`. Si querés apagar también la base (libera memoria),
corré `npm run db:stop`. Los datos no se pierden.

> Importante: si cerrás solo la web y dejás los trabajos sin worker, quedan "En cola" hasta que lo vuelvas
> a levantar. `npm run dev` siempre levanta los dos.

### Claves de API

Van en `.env.local` (nunca en el código ni en el repo):

| Variable | Qué es | Valor recomendado |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Clave de Claude | La tuya |
| `ANTHROPIC_MODEL` | Modelo de Claude (guion, shot list, prompts, lectura de PDFs) | `claude-opus-5` |
| `GEMINI_API_KEY` | Clave de Gemini | La tuya |
| `GEMINI_IMAGE_MODEL` | Modelo de imagen de Gemini ("Nano Banana") | `gemini-3.1-flash-image` |
| `OPENAI_API_KEY` | Clave de OpenAI | La tuya |
| `OPENAI_IMAGE_MODEL` | Modelo de imagen de OpenAI | `gpt-image-2.5-sunburst` (más preciso con referencias) o `gpt-image-2.5-flare` (más rápido) |
| `DEFAULT_IMAGE_ENGINE` | Motor de imagen elegido por defecto | `gemini` u `openai` |
| `WORKER_CONCURRENCY` | Cuántos trabajos corre el worker en paralelo | `3` |

Claude es obligatorio para casi todo (leer PDFs, guion, shot list, prompts). De los motores de imagen
alcanza con uno. Después de cambiar `.env.local`, reiniciá `npm run dev`.

### Modo de prueba (sin claves)

Con `ENGINE_MOCK=1` en `.env.local`, la app usa **motores simulados**: no llaman a ninguna API y cuestan
$0. El guion, el shot list y los prompts salen con texto de relleno y los frames son imágenes de colores.
Sirve para recorrer la interfaz o probar cambios sin gastar. Para volver a los motores reales, dejá
`ENGINE_MOCK=` vacío y reiniciá `npm run dev`.

### Direcciones útiles

| Qué | Dónde |
| --- | --- |
| La app | http://localhost:3000 |
| Supabase Studio (ver y editar la base a mano) | http://127.0.0.1:44323 |

Supabase usa los puertos **443xx** y no los 543xx de siempre, porque Windows tiene reservado ese rango en
esta máquina.

> **Seguridad:** la app no tiene login. Cualquiera que llegue al puerto 3000 puede usarla y gastar créditos
> de las APIs. Usala en tu máquina o en una red privada/VPN.

---

## 2. Cómo se usa

### Paso 0: la biblioteca del cliente

**Clientes → (el cliente)**. Todo lo que la IA necesita saber del cliente vive acá, y se adjunta solo a
cada etapa. Tiene cuatro pestañas.

**Textos.** La style bible, el system prompt de guion (el "master prompt"), el de imagen, el de video y el
negativo estándar.
- Cada texto tiene **versiones**. Al editar y tocar "Guardar versión N" se crea una versión nueva: nunca
  se pisa la anterior.
- De cada tipo hay una sola versión **en uso** (marcada con un tilde verde): es la que usa la IA. Con el
  selector de versiones podés ver una vieja y volver a ponerla en uso.

**Personajes.** Cada personaje tiene:
- nombre, rol y descripción (en español);
- **descriptor visual** en inglés: va textual en cada prompt de imagen donde aparece el personaje, así
  que tiene que describirlo bien (cara, contextura, pelo, EPP);
- sus **character sheets** (una o más imágenes);
- si está **basado en una persona real** y si el **consentimiento** está confirmado. Sin consentimiento
  confirmado, no se generan frames con ese personaje.

**Locaciones.** Nombre, descripción visual en inglés y sus **location plates** (fotos o renders del lugar
sin gente).

**Referencias.** Todas las imágenes del cliente:
- las **hojas de EPP activas** se adjuntan a todos los frames;
- el logo queda guardado como referencia pero no se adjunta solo;
- las sheets y plates se asignan desde las pestañas de Personajes y Locaciones.

### Paso 1: crear el proyecto

**Proyectos → Nuevo proyecto**: elegí el cliente, el título, la duración objetivo y el formato (16:9,
9:16, 1:1 o 4:3). El proyecto tiene cuatro etapas en un stepper arriba. Cada etapa muestra un tilde verde
cuando está aprobada y un resumen ("v3 aprobada", "8/8 aprobados", "5/8 elegidos").

En el encabezado del proyecto:
- el **costo acumulado**: tocalo para ver el desglose por operación y modelo;
- los **trabajos en curso**, cuando hay alguno;
- el engranaje de **ajustes**: título, duración, formato, notas y archivar.

### Paso 2: fuentes

Subí el material del cliente con **Subir archivos** (podés elegir varios) o **Pegar texto**.

| Tipo | Cómo se lee |
| --- | --- |
| PDF | Lo lee Claude y lo transcribe en orden, página por página, describiendo las fotos y diagramas importantes. Máximo ~24 MB. |
| PPTX | Se saca el texto de cada diapositiva en orden, las **notas del orador** y las imágenes embebidas. |
| DOCX | Se saca el texto con títulos, listas y tablas. |
| TXT / MD / texto pegado | Se usa tal cual. |

La extracción corre de fondo. Cuando termina podés **revisar y corregir el texto** antes de seguir:
lo que quede acá es lo que lee la IA para escribir el guion. Los archivos `.ppt` y `.doc` viejos no se
leen: guardalos como PPTX o DOCX.

### Paso 3: guion

A la izquierda completás los parámetros:
- duración y tono;
- público, experiencia previa y objetivo del curso;
- idioma de la locución (por defecto, rioplatense con voseo);
- qué incluir (quiz, errores frecuentes, simulación…);
- qué personajes del cliente puede usar;
- indicaciones extra.

Después tocás **Generar guion**.

Claude escribe el guion siguiendo el master prompt del cliente y un formato fijo:
- **escenas numeradas**, divididas en **tomas**;
- cada toma trae duración, tipo de plano, locución, acción visual, personajes, locación y texto en pantalla.

Arriba ves la cantidad de tomas y la duración estimada. Desde ahí podés:
- **Editar** el Markdown a mano. Al guardar se crea una versión nueva.
- **Regenerar con indicaciones** ("acortá la escena 2", "usá a Norma de protagonista"). Claude reescribe
  la versión que estás viendo y crea una nueva.
- Cambiar de versión con el selector.
- **Aprobar guion**. Solo hay una versión aprobada a la vez, y el shot list sale de esa.

### Paso 4: shot list

**Generar shot list** convierte cada toma del guion aprobado en un **plano**. Claude usa solo personajes
y locaciones que existen en la biblioteca.

La tabla es editable, y cada cambio se guarda al salir del campo. Podés:
- editar encuadre, personajes, locación, acción, locución, texto en pantalla, iluminación y notas;
- **arrastrar** desde el ícono de la izquierda para reordenar;
- desde el menú `…` de cada plano: dividir en dos (la locución se reparte), fusionar con el siguiente,
  agregar un plano debajo o borrar.

La **duración** de cada plano se calcula sola a partir de la locución (unas 2,5 palabras por segundo). El
total del video y la duración objetivo se ven arriba.

El punto de color al lado del número indica el estado: gris = sin aprobar, verde = aprobado,
celeste = con frame elegido. **Aprobar shot list** aprueba todos los planos pendientes. Si después
editás un plano aprobado, vuelve a "sin aprobar" y hay que reaprobarlo.

### Paso 5: frames

Arriba elegís el **motor** (Gemini u OpenAI) y cuántas **variantes** por plano (1 a 4). Cada plano
muestra:
- su resumen: encuadre, personajes, locación, acción y locución;
- el **prompt de imagen** y el **negativo**, editables. Si los editás, los próximos frames salen con
  tu versión;
- las **referencias que se van a adjuntar**: las sheets de sus personajes, la plate de su locación y
  la hoja de EPP;
- la grilla de frames.

Botones:
- **Generar prompt / Regenerar prompt**: Claude escribe el prompt de imagen y el negativo con el system
  prompt de imagen del cliente. También escribe un borrador de prompt de video para la fase 2.
- **Generar N variantes**: genera frames de ese plano. Si no tenía prompt, primero lo escribe.
- **Prompts faltantes**: prompts en lote para los planos que no tienen o que quedaron desactualizados.
- **Lote: planos sin frame elegido**: frames en lote para todo el proyecto, con progreso visible. Los
  frames van apareciendo a medida que se generan.

Sobre cada frame (al pasar el mouse):
- ✓ **Elegir**: queda como el frame de ese plano. Cuando todos los planos tienen frame elegido, el
  proyecto pasa a "Terminado".
- ✕ **Rechazar**: se oculta; lo ves con "Mostrar rechazados".
- 💬 **Nota de revisión**: por ejemplo "HSE: falta el detector de gases".
- Click en la imagen: la abre en tamaño completo.

Avisos que pueden aparecer:
- **"El plano cambió después de generar el prompt"**: editaste el plano en el shot list. Regenerá el
  prompt para que lo refleje.
- **"Prompt anterior"** sobre un frame: se generó con un prompt distinto al actual.
- **"Último intento falló: …"**: el motivo concreto (rate limit, contenido bloqueado, consentimiento
  faltante, clave mal configurada).

---

## 3. Cómo funciona por dentro

### Las piezas

```
 Navegador ──► Web (Next.js) ──► Supabase (Postgres + Storage)
                    │                  ▲
                    │ encola           │ lee y escribe
                    ▼                  │
               tabla jobs ◄──────── Worker ──► Claude / Gemini / OpenAI
```

- **Web (Next.js):** las pantallas y las acciones. Nunca llama a la IA directamente: cuando pedís algo
  largo (extraer, generar guion, frames…) **crea un trabajo** en la tabla `jobs` y vuelve enseguida.
- **Worker** (`worker/index.ts`): un proceso aparte que toma trabajos de la cola, llama a los motores y
  guarda los resultados. Corre hasta 3 trabajos a la vez y manda señales de vida mientras trabaja. Si se
  corta en medio de un trabajo, lo vuelve a poner en cola al reiniciar (hasta 3 intentos).
- **La UI consulta el estado** de los trabajos cada 1,5 s mientras hay alguno activo (8 s si no). Cuando
  uno termina, o cuando avanza un plano de un lote, la pantalla se refresca sola. Si falla, aparece un
  aviso con el motivo.
- **Supabase:** Postgres para los datos y Storage para los archivos. Hay dos buckets privados: `library`
  (imágenes de cada cliente) y `projects` (fuentes, imágenes extraídas y frames de cada proyecto). Las
  imágenes se muestran con links firmados que vencen en una hora, y cada imagen tiene una miniatura liviana.

### Motores intercambiables

Cada proveedor está detrás de un **adaptador** con una interfaz común (`src/lib/engines/`):

| Adaptador | Para qué | Cómo |
| --- | --- | --- |
| `ClaudeTextEngine` | Texto: PDF, guion, shot list, prompts | Streaming, pensamiento adaptativo, salida JSON validada con Zod, fallback automático si un filtro de seguridad rechaza el pedido |
| `GeminiImageEngine` | Frames | Interactions API, hasta 14 referencias, una imagen por llamada (las variantes van en paralelo) |
| `OpenAIImageEngine` | Frames | `images.edit` con las referencias (o `images.generate` si no hay), varias variantes por llamada |

Los **nombres de modelo salen siempre de `.env.local`**. Hay un **registro central** que la UI consulta
para ofrecer los motores configurados.

Todos manejan igual los errores:
- **Rate limit y caídas del servicio:** se reintentan con espera creciente.
- **Contenido bloqueado y claves inválidas:** fallan de una, con un mensaje claro que la UI muestra.

### Cómo se arma cada prompt

- **Guion:** system prompt = el *master prompt* del cliente + el formato fijo de escenas y tomas. El
  mensaje lleva los parámetros, la style bible, los personajes y locaciones disponibles y el texto de todas
  las fuentes.
- **Shot list:** instrucciones propias de la app + la style bible + personajes y locaciones **con sus ids**
  + el guion aprobado. La respuesta es JSON validado; los ids que no existen en la biblioteca se descartan.
- **Prompt de imagen (por plano):** system prompt = el *image system prompt* del cliente. El mensaje lleva:
  - el motor destino y el formato;
  - el tipo de plano y la acción;
  - el **descriptor visual de cada personaje**, textual, y la descripción de la locación;
  - la iluminación y el texto en pantalla;
  - qué referencias se van a adjuntar y el negativo estándar del cliente.

  Con el mismo esquema, el *video system prompt* genera el borrador de video.
- **Frame:** el prompt y el negativo del plano, más las imágenes de referencia, achicadas a 1536 px:
  - sheets de los personajes del plano (hasta 6);
  - plates de la locación;
  - hojas de EPP activas;
  - hasta 14 en total.

### Aprobaciones y estados

| Qué | Estados | Qué lo cambia |
| --- | --- | --- |
| Proyecto | Fuentes → Guion → Shot list → Frames → Terminado | Avanza solo: primer guion generado, guion aprobado, shot list aprobado, todos los planos con frame elegido |
| Guion | borrador / aprobado | "Aprobar guion" (una sola versión aprobada) |
| Plano | sin aprobar / aprobado / frame elegido | "Aprobar shot list", editar el plano (vuelve a sin aprobar), elegir un frame |

### Nada se borra

Todo **borrado** es lógico: el registro queda en la base con fecha de borrado y deja de mostrarse. La base
directamente **no permite** borrar filas. Los textos de la biblioteca y los guiones se **versionan**.
Regenerar el shot list reemplaza los planos pero los anteriores quedan en el historial, con sus frames.

### Costos

**Cada llamada a un motor** queda registrada en la tabla `engine_calls` con:
- modelo;
- duración;
- tokens e imágenes;
- costo estimado;
- el error, si falló.

El costo se calcula con los precios públicos de cada proveedor (en `src/lib/engines/`). Lo ves:
- en la lista de proyectos (costo acumulado);
- en el encabezado de cada proyecto, con el desglose por operación y modelo.

### Permisos

- La app no tiene login. Todo el acceso a la base lo hace **el servidor** con una clave de servicio que
  nunca llega al navegador.
- La clave pública de Supabase no tiene permisos sobre ninguna tabla ni archivo. El navegador solo la usa
  para subir archivos con un permiso de un solo uso que le da el servidor.

---

## 4. Si algo falla

| Síntoma | Qué hacer |
| --- | --- |
| Los trabajos quedan "En cola" y no avanzan | El worker no está corriendo. Usá `npm run dev` (levanta web + worker) o `npm run worker` en otra consola. |
| "Falta configurar Claude / Gemini / OpenAI" | Falta la clave o el modelo en `.env.local`. Completalos y reiniciá `npm run dev`. |
| "Límite de uso alcanzado (rate limit)" | El proveedor limitó los pedidos. La app ya reintentó; esperá un rato y volvé a generar. |
| "Bloqueó el pedido por sus filtros de contenido" | Reformulá el prompt del plano (o las indicaciones) y regenerá. |
| "Falta confirmar el consentimiento de …" | Biblioteca del cliente → Personajes → marcá "Consentimiento firmado y confirmado". |
| "El PDF pesa más de 24 MB" | Dividilo o exportalo más liviano. |
| La página no carga o dice que no conecta con la base | Abrí Docker Desktop y corré `npm run db:start`. |
| Docker Desktop se reinició y la API dejó de responder | `npm run db:stop` y después `npm run db:start` (los datos se conservan). |
| Quiero ver o corregir datos a mano | Supabase Studio en http://127.0.0.1:44323. |

---

## 5. Para quien toque el código

| Comando | Qué hace |
| --- | --- |
| `npm run check` | Lint + typecheck |
| `npm run build` | Build de producción |
| `npm run db:types` | Regenera los tipos de TypeScript de la base después de una migración |
| `npm run db:reset` | Recrea la base local desde las migraciones (**borra los datos locales**) |

| Carpeta | Qué hay |
| --- | --- |
| `supabase/migrations/` | Esquema, permisos, buckets y vistas de costos. Cada cambio de base es una migración nueva. |
| `seed/clear/` | Documentos, sheets y JSON de personajes y locaciones de Clear Petroleum |
| `worker/` | El proceso de trabajos |
| `src/lib/engines/` | Adaptadores de Claude, Gemini, OpenAI, los simulados, precios y reintentos |
| `src/lib/jobs/` | Cola, runner y un handler por tipo de trabajo |
| `src/lib/pipeline/` | Cómo se arma cada etapa: prompts, reglas del shot list, referencias |
| `src/lib/ingest/` | Lectores de PPTX y DOCX |
| `src/app/` | Pantallas y acciones del servidor |

La especificación completa del producto está en [CLAUDE.md](CLAUDE.md) y el resumen técnico en
[README.md](README.md).

### Lo que viene (fases 2 y 3)

La base ya tiene las tablas `voiceovers`, `clips` y `timelines`, y cada plano guarda un borrador de
prompt de video. Falta:
- voz en off con ElevenLabs;
- clips de video (Veo, Seedance) a partir del frame elegido;
- el timeline;
- la exportación a Premiere o DaVinci.
