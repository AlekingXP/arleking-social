# Análisis de seguridad

Sistema de análisis para detectar contenido dañino en ArleKing Social:
enlaces que pueden ejecutar código, archivos que no son lo que dicen ser, y
texto con carga de inyección.

## Lo importante primero: esto no toca la página

Nada de lo que hay en `security/` es requerido por `server.js`. Es un
programa aparte que se ejecuta cuando tú quieras.

- Abre la base de datos **en modo solo lectura** (`readonly: true`), así que
  no puede escribir ni borrar aunque tuviera un fallo.
- No arranca ningún servidor, no abre ningún puerto, no modifica archivos.
- Lo peor que puede hacer una ejecución es imprimir texto.

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

## Modo informe, no bloqueo

Ahora mismo el sistema **detecta y reporta**; no rechaza nada en el momento
de subir ni de guardar. Es deliberado: así no puede romper la página ni
bloquear a un usuario legítimo por un falso positivo.

Para pasar a prevención hay dos enganches naturales, ambos ya cubiertos por
estas reglas:

1. **Enlaces** — en `routes/admin.js`, al crear y editar un enlace, llamar a
   `analyzeUrl(url)` y rechazar con 400 si hay algo `critical`.
2. **Subidas** — en el `fileFilter`/después de `multer`, llamar a
   `analyzeFile(ruta, ext)` y borrar el archivo si hay `critical` o `high`.

Recomendación: pasar primero los enlaces (el riesgo real es que la
plataforma distribuya phishing bajo tu dominio) y dejar las subidas en modo
informe unas semanas, para medir falsos positivos con archivos de usuarios
reales antes de empezar a rechazar.

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

`scanner.js` no importa nada de la aplicación, así que las reglas se pueden
reutilizar dentro del servidor cuando se decida pasar a modo bloqueo.
