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
} from './password';
export type { ParametrosScrypt } from './password';

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
} from './totp';
export type { AlgoritmoTotp, OpcionesTotp } from './totp';

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
} from './cifrado';

export {
  MINUTOS_SESION_MAXIMO,
  MINUTOS_SESION_POR_DEFECTO,
  abrirSesion,
  cerrarSesion,
  generarTokenSesion,
  hashTokenSesion,
  revocarSesionesDeUsuario,
} from './sesion';
export type { DatosSesion, OpcionesAbrirSesion } from './sesion';

export { CredencialInvalidaError, MfaRequeridoError, iniciarSesion } from './autenticacion';
export type { MotivoFallo, OpcionesInicioSesion } from './autenticacion';

export {
  CODIGO_ROL,
  PERMISOS,
  PermisoInsuficienteError,
  ROLES,
  exigirPermiso,
  permisosDeLaSesion,
  tienePermiso,
} from './permisos';
export type { CodigoRol, Permiso } from './permisos';
