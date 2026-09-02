# Análisis de seguridad

Sistema de análisis para detectar contenido dañino en ArleKing Social:
enlaces que pueden ejecutar código, archivos que no son lo que dicen ser, y
texto con carga de inyección.

## Qué está activo y qué no

| Superficie | Modo | Efecto |
|---|---|---|
| Enlaces | **bloqueo** | Rechaza con 400 los hallazgos `critical` al crear o editar |
| Subidas | informe | Solo se ven ejecutando el escáner |
| Texto | informe | Solo se ven ejecutando el escáner |

`routes/admin.js` importa `rules/urls.js` — es el **único** punto de la
aplicación acoplado a `security/`. Todo lo demás sigue siendo un programa
aparte que se ejecuta cuando tú quieras:

- Abre la base de datos **en modo solo lectura** (`readonly: true`), así que
  no puede escribir ni borrar aunque tuviera un fallo.
- No arranca ningún servidor, no abre ningún puerto, no modifica archivos.
- Lo peor que puede hacer una ejecución del escáner es imprimir texto.

Ejecutarlo con la web en marcha es seguro.

## Cómo se usa

```bash
npm run security
```

Otras formas:

```bash
npm run security -- --json                    # salida JSON, para procesar
npm run security -- --fail-on high            # sale con código 1 si hay algo high o peor
DATA_DIR=/ruta/al/disco npm run security      # analizar los datos de producción
```

El código de salida con `--fail-on` permite usarlo en CI sin nada más.

## Qué revisa

### Enlaces (`rules/urls.js`)

| Comprobación | Severidad | Por qué importa |
|---|---|---|
| Esquema `javascript:`, `data:`, `vbscript:`, `blob:`, `file:` | crítica | Ejecuta código en el navegador del visitante |
| Caracteres de control en el enlace | crítica | Esconde el esquema real de una comprobación ingenua |
| Credenciales antes del dominio (`banco.com@evil.tk`) | alta | Disfraza el destino real |
| Mezcla de alfabetos en el dominio | alta | Homógrafos: `аpple.com` con "а" cirílica |
| Marca conocida + palabra gancho fuera de su dominio | alta | Patrón de phishing (`paypal-verify.evil.com`) |
| Dominio codificado en porcentajes | alta | Oculta a dónde apunta |
| Punycode, IP cruda, esquema inesperado | media | Merecen una mirada humana |
| Acortador, muchos subdominios, enlace larguísimo | baja | Señales débiles, contexto |

### Archivos subidos (`rules/files.js`)

Se identifican **por sus bytes iniciales, no por la extensión**. El filtro de
`routes/admin.js` confía en `path.extname(originalname)`, que elige quien
sube el archivo: renombrar `payload.exe` a `payload.jpg` lo atraviesa.

| Comprobación | Severidad |
|---|---|
| Ejecutable real (PE/ELF/Mach-O/class) bajo extensión de imagen | crítica |
| SVG (se renderiza como documento y ejecuta su script) | crítica |
| Archivo comprimido (zip/rar/7z/gzip) disfrazado de imagen | alta |
| Contenido que no es ninguna imagen conocida | alta |
| Polyglot: imagen válida con contenido activo incrustado | alta |
| Extensión que no concuerda con el contenido real | media |
| Huérfano (sin referencias) o referenciado pero ausente | baja |

**Sobre los falsos positivos:** buscar patrones sobre el binario entero
produce coincidencias por azar dentro de los datos comprimidos de un PNG
legítimo. Por eso solo se buscan sobre las **tiras legibles** del archivo
(rachas de 16+ bytes imprimibles): una carga real es texto legible, el ruido
binario no se mantiene imprimible tanto rato.

### Texto (`rules/text.js`)

Etiquetas `<script>`, `<iframe>`, manejadores de eventos, `javascript:`,
caracteres bidireccionales y de ancho cero en los campos de perfil y enlaces.

Se reportan como **media**, no como alta, y con razón: hoy ese texto llega a
la página vía `textContent`, que escapa automáticamente, así que está
inerte. Lo que se señala es que la base de datos lo *guarda*, y pasaría a ser
explotable el día que ese texto se renderice como HTML, se meta en un correo,
en un PDF o en una página generada en el servidor.

## Estado actual: enlaces bloquean, subidas solo informan

### Enlaces — ACTIVO (bloqueo)

`routes/admin.js` llama a `analyzeUrl()` al **crear y al editar** un enlace y
responde 400 si hay algún hallazgo `critical`. Es el único punto de la
aplicación que importa algo de `security/`.

Solo bloquea `critical` (esquemas ejecutables y caracteres de control): no
hay uso honesto de `javascript:` en una página de enlaces. Los hallazgos
`high`, `medium` y `low` — phishing, homógrafos, acortadores — se registran
en el log del servidor con el prefijo `[seguridad]` pero **no** se rechazan,
porque un falso positivo ahí dejaría a un usuario legítimo sin poder editar
su propia página.

**Falla abierto a propósito.** Si `analyzeUrl` lanzara una excepción, se
registra y el enlace se guarda igual. Esto es defensa en profundidad, no el
único control: un fallo del escáner no puede tumbar la edición de enlaces
para todo el mundo.

Para revisar los avisos que no bloquean:

```bash
# en los logs de Render
grep "\[seguridad\]"
```

### Subidas — INFORME (no bloquea)

Deliberadamente sin activar todavía, para medir falsos positivos con
archivos de usuarios reales antes de empezar a rechazar. Cuando se quiera
activar, el enganche es llamar a `analyzeFile(ruta, ext)` después de multer
y borrar el archivo si hay `critical` o `high`.

### Texto — INFORME (no bloquea)

Y probablemente deba quedarse así: hoy ese texto se escapa con
`textContent`, así que rechazarlo molestaría a usuarios sin ganar seguridad
real.

### Enlaces ya guardados

El bloqueo solo cubre lo que se guarda a partir de ahora. Para revisar lo que
ya existe, `npm run security` los analiza todos.

## Estructura

```
security/
  scan.js          CLI: abre la base en solo lectura e imprime el informe
  scanner.js       motor: recibe datos, devuelve hallazgos. Sin Express.
  rules/
    urls.js        análisis de enlaces
    files.js       análisis de archivos por contenido
    text.js        análisis de campos de texto
```

`scanner.js` no importa nada de la aplicación. Esa independencia es lo que
permite que `routes/admin.js` reutilice `rules/urls.js` en caliente sin
arrastrar consigo el CLI ni el acceso a la base de datos.
