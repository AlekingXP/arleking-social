# Autenticación endurecida

Módulos de seguridad del registro y el inicio de sesión. Referencias:
OWASP ASVS 4.0, OWASP Cheat Sheets (Password Storage, Authentication,
Session Management, CSRF) y NIST SP 800-63B.

---

## Vulnerabilidades encontradas y corregidas

Cada una se comprobó de forma reproducible antes de tocar el código.

### 1. Enumeración de cuentas por temporización — corregida

El login llamaba a `bcrypt.compareSync` sólo si el usuario existía. Un
usuario inexistente respondía en microsegundos; uno real costaba una
verificación completa.

```
usuario EXISTE     -> 58.21 ms
usuario NO existe  ->  0.000 ms
diferencia: 970.198x
```

Cualquiera podía averiguar qué nombres de usuario están registrados
midiendo el tiempo de respuesta.

`verifyPassword()` ahora verifica contra un hash señuelo (`DUMMY_HASH`)
cuando la cuenta no existe o no tiene contraseña, así que el coste es el
mismo en ambos casos.

```
usuario EXISTE     ->  9.83 ms
usuario NO existe  ->  8.86 ms
diferencia: 1.11x
```

### 2. Fuerza bruta distribuida — corregida

El único límite era `express-rate-limit` por IP (10 intentos / 15 min). Un
atacante con IPs rotativas tenía intentos ilimitados contra una cuenta
concreta, que es exactamente como funciona el credential stuffing real.

`lockout.js` cuenta los fallos **por cuenta**, venga de donde venga, con
espera exponencial (30s, 60s, 120s… hasta 15 min). Verificado con IPs
rotativas: los cuatro primeros intentos pasan, del quinto en adelante 429.

El bloqueo es una **espera con tope**, no un bloqueo permanente: si no,
cualquiera podría dejar a un usuario fuera de su propia cuenta a voluntad y
la defensa se convertiría en el ataque.

### 3. Sesiones en memoria — corregida

`express-session` usaba MemoryStore, que su propia documentación marca como
no apto para producción: pierde memoria y **cada despliegue cerraba la
sesión de todos**. Sustituido por `session-store.js` (SQLite), que además
permite revocar sesiones — imposible con MemoryStore.

### 4. Sin CSRF — corregida

La app se apoyaba en dos defensas accidentales: `SameSite=Lax` y que
`express.json()` sólo acepta `application/json`. Ambas se sostienen hoy,
pero son efectos secundarios de otras decisiones: bastaría aceptar
`urlencoded` o relajar SameSite para un embebido y la protección
desaparecería en silencio.

Ahora hay token de sincronización ligado a la sesión, comparado en tiempo
constante. Verificado: sin token 403, con token equivocado 403, con el token
correcto 200.

### 5. Sin CSP — corregida

Ver abajo. Era la única cabecera importante que faltaba.

### 6. `X-Powered-By: Express` — corregida

Le decía a cualquier escáner qué lista de CVE probar.

---

## Qué hay ahora

| Módulo | Qué hace |
|---|---|
| `password.js` | Argon2id (m=19 MiB, t=2, p=1, el mínimo OWASP) + política NIST |
| `common-passwords.js` | Lista de bloqueo, con entradas en español |
| `lockout.js` | Bloqueo por cuenta con espera exponencial |
| `session-store.js` | Sesiones en SQLite, con revocación |
| `csrf.js` | Token de sincronización |
| `csp.js` | CSP con hashes calculados del HTML real |
| `totp.js` | Segundo factor TOTP (RFC 6238) sin dependencias |
| `audit.js` | Registro de eventos sin datos sensibles |

### Contraseñas

Argon2id con los parámetros mínimos de OWASP. **Los hashes bcrypt
existentes siguen funcionando** y se migran solos la próxima vez que su
dueño inicia sesión — es el único momento en que la contraseña en claro
está disponible, así que la migración ocurre ahí o no ocurre. Nadie queda
fuera por el cambio.

Política según NIST SP 800-63B: mínimo 8 caracteres, lista de bloqueo, y
**sin** reglas de composición (símbolos obligatorios, mayúsculas). Esas
reglas empujan a la gente hacia patrones predecibles sin añadir entropía
real.

### TOTP

Implementado sobre `node:crypto`, sin dependencias: TOTP es HMAC-SHA1 sobre
un contador de tiempo, y meter un paquete para eso añadiría superficie de
cadena de suministro justo en el componente cuyo trabajo es ser fiable.

Validado contra **los cinco vectores oficiales del RFC 6238**. Si alguna vez
falla uno, la implementación está mal — no lo ajustes a ojo.

Alta en dos pasos a propósito: el secreto no se guarda hasta que el usuario
demuestra que su app genera un código válido. Guardarlo en el primer paso
dejaría fuera a cualquiera cuyo escaneo fallara en silencio.

Ocho códigos de recuperación de un solo uso, guardados **sólo como hash
SHA-256**. Se muestran una vez y no se pueden volver a mostrar.

Para desactivar el MFA se exigen contraseña **y** código: una sesión robada
no puede quitar por sí sola la protección que existe justo para eso.

### CSP

Las páginas son HTML estático con unos pocos `<script>` en línea, así que no
hay nonce disponible — no existe un paso de plantilla donde inyectarlo. La
salida fácil es `'unsafe-inline'`, que tira por la borda casi todo el valor
de la CSP: vuelve a permitir exactamente el `<script>` inyectado que la
política existe para frenar.

En vez de eso, `csp.js` **calcula los hashes del HTML real al arrancar**.
Resultado: `script-src` sin `'unsafe-inline'`, y se mantiene solo — editar
un script en línea cambia su hash y el siguiente arranque lo recoge.

`style-src` sí conserva `'unsafe-inline'`: hay atributos `style="..."` por
todas partes y el CSS inyectado no ejecuta script. Es una exposición real
pero mucho menor.

Dos permisos que parecen laxos y no lo son:

- **`'wasm-unsafe-eval'`** — lo necesita el decodificador meshopt para
  descomprimir la geometría de los modelos 3D. Pese al nombre **no**
  reactiva `eval()` ni `new Function()` sobre JavaScript: permite compilar
  WebAssembly y nada más. `'unsafe-eval'` sería el peligroso.
- **`blob:` en `connect-src`** — GLTFLoader convierte cada textura incrustada
  en el `.glb` en una object URL y la vuelve a pedir. Esos blobs los crea la
  propia página con bytes que ya tenía; un `blob:` no puede alcanzar nada
  externo.

> **Trampa que costó encontrar:** el navegador normaliza CRLF a LF al parsear
> el HTML, así que el hash debe calcularse sobre LF. Con los archivos en CRLF
> (Windows) el hash no coincide y el script queda bloqueado. En Linux
> funcionaba por casualidad. `csp.js` normaliza siempre.

### Auditoría

Registra qué pasó y desde dónde, **sin** convertir el propio registro en una
filtración: nada de contraseñas, códigos TOTP, identificadores de sesión ni
IP en claro. La IP se guarda como HMAC con sal, lo que permite agrupar
eventos por origen y detectar una dirección atacando muchas cuentas, pero no
se puede revertir.

Comprobado sobre la tabla real: no aparece la contraseña, ni el secreto
TOTP, ni ninguna IP.

Detecta dos patrones:
- **`suspicious_new_ip`** — primer acceso correcto desde un origen nuevo.
- **`suspicious_burst`** — un mismo origen fallando contra 5+ cuentas
  distintas en 15 minutos: eso es credential stuffing, no un despiste.

### Revocación de sesiones

Cambiar la contraseña es lo que hace alguien que sospecha que la anterior
está comprometida. Dejar viva la sesión del atacante haría inútil el gesto,
así que se revocan **todas las demás** sesiones. La actual sobrevive: echar
al usuario de la página en la que está le enseña a no molestarse en
cambiarla la próxima vez.

Verificado simulando el escenario: la sesión del atacante muere, la de la
víctima sigue viva.

---

## Lo que NO está implementado

Dicho explícitamente, porque un README de seguridad que insinúa cobertura
que no existe es peor que no tenerlo.

### Verificación de correo — no implementada

**Falta la infraestructura, no el código.** La tabla `users` no tiene
columna de correo (sólo `google_email`, que llega por OAuth) y no hay
proveedor de envío configurado. Hacerla obligatoria además dejaría fuera a
todas las cuentas existentes de golpe.

Para tenerla hacen falta: una columna `email`, un proveedor (Resend,
Postmark, SES) con su clave en las variables de entorno, tabla de tokens de
un solo uso con caducidad, y un periodo de gracia para las cuentas actuales.

### Recuperación de cuenta — no implementada

Depende de lo anterior: un "he olvidado mi contraseña" sin correo verificado
no es recuperación, es una puerta trasera. Hoy la recuperación real son los
códigos de MFA y el acceso por Google/GitHub.

### WebAuthn / Passkeys — no implementado

Es la pieza grande que falta. Requiere registro y verificación de
attestation, almacenamiento de credenciales, y manejo de varios
autenticadores por cuenta.

**Sobre "WebAuthn obligatorio":** no lo recomiendo en esta plataforma.
Dejaría fuera a cualquiera sin dispositivo compatible, y para un sitio de
enlaces personales el coste en usuarios perdidos supera al riesgo que
elimina. Tiene sentido como opción, e incluso como obligatorio sólo para
cuentas propietarias.

### QR para el MFA — no implementado

El alta funciona por introducción manual de la clave, que toda app de
autenticación admite. Un QR mejoraría la adopción; generarlo requiere
implementar la codificación QR o vendorizar una librería.

### Monitoreo continuo con alertas — parcial

Los eventos se registran y los patrones sospechosos se marcan, pero **nadie
recibe un aviso**. Falta el canal de salida (correo, webhook, Slack). El
`audit.js` ya expone `recentFailures()` y `accountsTargetedFrom()`, que es
lo que necesitaría un trabajo periódico para disparar alertas.

---

## Variables de entorno

Ningún secreto está en el código. El secreto de sesión se genera solo y vive
en el disco persistente (`data/.session-secret`), no en el repositorio. La
sal de la auditoría se deriva de él.

Las credenciales que sí son variables de entorno: `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*`, `GOOGLE_CLIENT_ID/SECRET`,
`GITHUB_CLIENT_ID/SECRET`, `OWNER_USERNAMES`.
