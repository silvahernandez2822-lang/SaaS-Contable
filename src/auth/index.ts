/**
 * Superficie pública de seguridad — Agente A12, Ola 0.
 *
 * Punto de entrada único para A6 (servicios) y A7 (interfaz). Lo que importa:
 *
 *  - El contexto de una petición SIEMPRE se abre con `withSessionContext`, con
 *    el token de sesión. No existe forma soportada de decirle a la base "soy el
 *    tenant X": el tenant lo deriva ella del token (cierre de D-020).
 *  - El camino de autenticación corre con el rol `app_auth`, separado del rol
 *    de las peticiones. No lo use para nada más.
 *  - La autorización la impone la base de datos. `exigirPermiso` sirve para dar
 *    un mensaje temprano, no para proteger.
 */
export {
  ALGORITMO_PASSWORD,
  LONGITUD_MINIMA_PASSWORD,
  PARAMETROS_ACTUALES,
  PasswordDebilError,
  exigirPasswordAceptable,
  hashearPassword,
  necesitaRehash,
  verificarPassword,
} from './password.js';
export type { ParametrosScrypt } from './password.js';

export {
  OPCIONES_POR_DEFECTO,
  base32Decode,
  base32Encode,
  contadorTotp,
  generarCodigoTotp,
  generarSecretoTotp,
  hotp,
  uriOtpauth,
  verificarCodigoTotp,
} from './totp.js';
export type { AlgoritmoTotp, OpcionesTotp } from './totp.js';

export {
  CifradoInvalidoError,
  ClaveCifradoAusenteError,
  ESQUEMA_CIFRADO,
  VARIABLE_CLAVE,
  cifrar,
  claveDeEntorno,
  claveDesdeBase64,
  descifrar,
  generarClave,
} from './cifrado.js';

export {
  MINUTOS_SESION_MAXIMO,
  MINUTOS_SESION_POR_DEFECTO,
  abrirSesion,
  cerrarSesion,
  generarTokenSesion,
  hashTokenSesion,
  revocarSesionesDeUsuario,
} from './sesion.js';
export type { DatosSesion, OpcionesAbrirSesion } from './sesion.js';

export { CredencialInvalidaError, MfaRequeridoError, iniciarSesion } from './autenticacion.js';
export type { MotivoFallo, OpcionesInicioSesion } from './autenticacion.js';

export {
  CODIGO_ROL,
  PERMISOS,
  PermisoInsuficienteError,
  ROLES,
  exigirPermiso,
  permisosDeLaSesion,
  tienePermiso,
} from './permisos.js';
export type { CodigoRol, Permiso } from './permisos.js';
