'use strict';

// Blocklist of passwords that appear at the top of every credential dump.
//
// NIST SP 800-63B asks that chosen passwords be compared against a list of
// known-compromised values. A full breach corpus is hundreds of megabytes;
// this is the head of the distribution, which is where real attacks
// concentrate -- a credential-stuffing run tries these first, and they are
// what people actually pick when left to themselves.
//
// Comparison is done lowercased and trimmed, so only lowercase entries here.

const LIST = [
  '123456', '123456789', '12345678', '1234567890', '1234567', '12345',
  'password', 'password1', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword',
  'qwerty', 'qwerty123', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1q2w3e4r',
  'abc123', 'abcd1234', 'a1b2c3d4', 'iloveyou', 'admin', 'admin123',
  'administrator', 'welcome', 'welcome1', 'welcome123', 'letmein',
  'monkey', 'dragon', 'sunshine', 'princess', 'football', 'baseball',
  'superman', 'batman', 'trustno1', 'master', 'shadow', 'michael',
  'jennifer', 'jordan', 'harley', 'ranger', 'hunter', 'buster', 'soccer',
  'hockey', 'killer', 'george', 'sexy', 'andrew', 'charlie', 'thomas',
  'robert', 'daniel', 'starwars', 'pokemon', 'minecraft', 'computer',
  'internet', 'samsung', 'google', 'facebook', 'whatever', 'nothing',
  'freedom', 'whatever1', 'qazwsx', 'zaq12wsx', '1qaz2wsx', 'q1w2e3r4',
  '11111111', '00000000', '88888888', '123123', '123321', '112233',
  '654321', '666666', '777777', '121212', '131313', '555555', '999999',
  'test1234', 'test123', 'testing', 'temp1234', 'changeme', 'default',
  'secret', 'secret123', 'letmein123', 'passpass', 'mypassword',

  // Spanish-language entries -- this platform's users are Spanish speakers,
  // and the English top-100 misses what they actually choose.
  'contrasena', 'contraseña', 'contrasena1', 'contrasena123',
  'hola1234', 'holahola', 'holamundo', 'teamo', 'teamo123', 'teamomucho',
  'mivida', 'micorazon', 'mifamilia', 'mimadre', 'mipadre',
  'colombia', 'colombia1', 'mexico123', 'espana123', 'argentina',
  'america', 'america1', 'chivas', 'barcelona', 'realmadrid', 'boca',
  'futbol', 'futbol123', 'jesus', 'jesucristo', 'diosesamor', 'diosesbueno',
  'principe', 'princesa', 'princesa1', 'bebe', 'bebita', 'mibebe',
  'estrella', 'mariposa', 'chocolate', 'chiquita', 'hermosa', 'preciosa',
  'usuario', 'usuario1', 'usuario123', 'clave', 'clave123', 'claveclave',
  'sinclave', 'nolase', 'nose', 'nosecual', 'asdasd', 'asdasd123',
];

const COMMON_PASSWORDS = new Set(LIST);

module.exports = { COMMON_PASSWORDS };
