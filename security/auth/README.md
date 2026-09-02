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
| `webauthn.js` | Passkeys (Face ID, huella, Hello) como credencial completa |
| `trusted-device.js` | Recordar un dispositivo 24h para no pedir el TOTP siempre |
| `alerts.js` | Saca los eventos sospechosos por webhook |

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

### Dispositivos recordados

Pedir el código en cada inicio de sesión es la razón principal por la que la
gente acaba desactivando el MFA, que cambia una molestia pequeña por perder
toda la protección. Un dispositivo que ya pasó el segundo factor puede
saltárselo durante **24 horas**.

El límite que hace esto defendible: la cookie **sólo salta el segundo
factor, nunca la contraseña**. Quien la robe está exactamente igual de lejos
de la cuenta que quien se enfrenta a una cuenta sin MFA — que es justo el
escenario con el que hay que comparar esta función, no con el ideal.

- Se guarda **sólo el digest SHA-256**; el token nunca toca la base.
- Cookie `HttpOnly`, así que ningún script de la página puede leerla.
- Un token de otra cuenta no sólo se rechaza: se **borra**, porque sólo puede
  significar una cookie manipulada o rancia.
- La confianza se renueva únicamente tras verificar un código real, así que
  nunca se prorroga sola.
- Se revoca al desactivar el MFA, al cambiar la contraseña, y con el botón
  **Olvidar todos** del panel.
- Ante cualquier error interno **falla cerrado**: pide el código. El coste es
  una molestia; el de fallar abierto sería saltarse el factor.

### Passkeys (WebAuthn) — lo que el usuario llama "Face ID"

No existe una API de Face ID para la web. Face ID, Touch ID, Windows Hello y
la huella de Android se alcanzan todas a través del mismo autenticador de
plataforma de WebAuthn, así que implementarlo una vez cubre las cuatro.

**Una passkey es una credencial completa, no un segundo factor.** Tanto el
registro como el acceso exigen `userVerification: 'required'`, así que el
dispositivo más la biometría o el PIN ya son dos factores, y además es
resistente al phishing de un modo que una contraseña nunca puede ser. Pedir
además la contraseña la haría estrictamente peor que la contraseña sola: más
fricción sin más garantía.

**Por qué aquí sí uso una librería.** `totp.js` está escrito a mano porque
TOTP son cuarenta líneas de HMAC-SHA1. WebAuthn es lo contrario:
decodificación CBOR, análisis de claves COSE, verificación de attestation en
varios formatos y comprobación de firmas. Escribir eso a mano es justo donde
se cuela un bypass de autenticación silencioso, así que va sobre
`@simplewebauthn/server` (JavaScript puro, sin compilación nativa).

Se comprobó con un **autenticador por software** que genera una clave P-256 y
firma de verdad, para verificar la criptografía del servidor y no sólo que
el código compile:

| Comprobación | Resultado |
|---|---|
| Registro y acceso con firma válida | acepta |
| Acceso sin contraseña ni código | concede sesión |
| Firma manipulada (un bit) | rechaza |
| Origen falso (`...net.evil.tk`) | rechaza |
| Challenge de otra sesión (replay) | rechaza |
| Challenge reutilizado | rechaza |
| Contador retrocedido (autenticador clonado) | rechaza |
| Credencial no registrada | rechaza |

El contador de firmas sólo avanza en un autenticador auténtico; que
retroceda es la única señal que una clave pública robada no puede falsificar,
y por eso se comprueba. Las passkeys sincronizadas informan 0 para siempre de
forma legítima, así que la comprobación sólo se aplica cuando ya hay un
contador en uso.

`rpID` y origen se derivan de la petición, con `WEBAUTHN_RP_ID` y
`WEBAUTHN_ORIGIN` como anulación. Esa vinculación al dominio es lo que hace
que una passkey no se pueda replicar contra un sitio de phishing.

Eliminar la última llave se rechaza si es la única forma de entrar, la misma
regla que sigue el desvinculado de OAuth.

**Sobre "WebAuthn obligatorio":** sigo sin recomendarlo. Dejaría fuera a
cualquiera sin dispositivo compatible, y para un sitio de enlaces personales
el coste en usuarios perdidos supera al riesgo que elimina. Como opción, que
es como está, tiene todo el sentido.

### Alertas

Los eventos sospechosos ya no se quedan en una tabla que hay que ir a mirar.
Configura `ALERT_WEBHOOK_URL` y salen por webhook.

Por webhook y no por correo: no hay proveedor de envío configurado (el mismo
bloqueo que impide la verificación de correo), y un webhook funciona con
Discord, Slack o cualquier endpoint que acepte un POST, sin añadir ni una
dependencia ni una cuenta más. El formato del cuerpo se adapta según el
destino (`content` para Discord, `text` para Slack, objeto completo para el
resto).

Qué avisa: `suspicious_burst`, `login_locked`, `mfa_disabled`,
`password_change`, `passkey_added`, `passkey_removed`, `account_delete`,
`oauth_link`, `suspicious_new_ip` y `mfa_devices_forgotten`. Un `login_ok` o
un `logout` no interrumpen a nadie: eso es para lo que está la auditoría.

Tres reglas que lo gobiernan:

1. **No manda nada sensible.** Misma regla que la auditoría: ni contraseñas,
   ni códigos, ni identificadores de sesión, ni IP en claro. Del origen sale
   sólo un prefijo de 8 caracteres del digest, suficiente para relacionar dos
   avisos e inútil para localizar a nadie. Comprobado sobre los mensajes
   reales.
2. **Nunca rompe la petición.** Se envía sin esperar respuesta y cualquier
   fallo se traga: quedarse sin avisar es malo, tumbar un inicio de sesión
   por ello es peor. Verificado con un webhook que lanza.
3. **Se limita sola.** Silencio de 10 minutos por tipo+cuenta y tope de 20
   mensajes por hora. Un ataque de fuerza bruta genera cientos de eventos, y
   mandar cientos de mensajes convierte la alerta en ruido que se silencia —
   que es exactamente perder la alerta. Verificado: 10 eventos iguales
   producen 1 aviso; 50 cuentas distintas con tope 5 producen 5.

Hay un envío de prueba en `POST /api/alerts/test`, sólo para el propietario y
con su propio limitador, para comprobar la URL sin esperar a un incidente.

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

### QR para el MFA — no implementado

El alta funciona por introducción manual de la clave, que toda app de
autenticación admite. Un QR mejoraría la adopción; generarlo requiere
implementar la codificación QR o vendorizar una librería.

---

## Variables de entorno

Ningún secreto está en el código. El secreto de sesión se genera solo y vive
en el disco persistente (`data/.session-secret`), no en el repositorio. La
sal de la auditoría se deriva de él.

Las credenciales que sí son variables de entorno: `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*`, `GOOGLE_CLIENT_ID/SECRET`,
`GITHUB_CLIENT_ID/SECRET`, `OWNER_USERNAMES`.
