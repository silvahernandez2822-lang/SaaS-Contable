/**
 * Escenarios mínimos reutilizables por todos los agentes.
 *
 * Todo se monta con `asAdmin` (superusuario) porque el montaje incluye filas
 * que la aplicación no puede escribir. Las pruebas de comportamiento deben
 * volver a `asTenant` para operar.
 *
 * Aquí NO hay ningún valor tributario real: las tarifas y bases que aparecen
 * son inventadas para probar mecánica de vigencias, y llevan `norma_respaldo`
 * que lo dice. Los datos normativos los puebla A1 en la Ola 1.
 */
import type { SqlClient } from '../../src/db/types.js';
import type { TestDb } from './db.js';
import { uuid } from './db.js';

export interface CuentasEscenario {
  /** Clase 5 — no imputable, sirve para probar LG004. */
  claseGasto: string;
  /** Cuenta de gasto imputable (débito). */
  gasto: string;
  /** IVA descontable imputable (débito). */
  ivaDescontable: string;
  /** Proveedores nacionales imputable (crédito). */
  proveedores: string;
  /** Retención en la fuente por pagar imputable (crédito). */
  retefuentePorPagar: string;
}

export interface Escenario {
  tenantId: string;
  companyId: string;
  userId: string;
  fiscalPeriodId: string;
  municipalityId: string;
  ciiuId: string;
  thirdPartyId: string;
  sourceDocumentId: string;
  approvalId: string;
  cuentas: CuentasEscenario;
}

let contador = 0;
function sufijo(): string {
  contador += 1;
  return `${Date.now().toString(36)}${contador.toString(36)}`;
}

/** Monta una firma con una empresa, un usuario, un período abierto, PUC mínimo,
 *  un tercero, un documento fuente y su aprobación. */
export async function crearEscenario(
  db: TestDb,
  opciones: { razonSocial?: string } = {},
): Promise<Escenario> {
  const s = sufijo();
  const e: Escenario = {
    tenantId: uuid(),
    companyId: uuid(),
    userId: uuid(),
    fiscalPeriodId: uuid(),
    municipalityId: uuid(),
    ciiuId: uuid(),
    thirdPartyId: uuid(),
    sourceDocumentId: uuid(),
    approvalId: uuid(),
    cuentas: {
      claseGasto: uuid(),
      gasto: uuid(),
      ivaDescontable: uuid(),
      proveedores: uuid(),
      retefuentePorPagar: uuid(),
    },
  };

  await db.asAdmin(async (tx) => {
    await tx.query(
      `INSERT INTO tenant (id, nit, razon_social, email_contacto)
       VALUES ($1, $2, $3, $4)`,
      [e.tenantId, `900${s}`, opciones.razonSocial ?? `Firma ${s}`, `firma-${s}@ejemplo.co`],
    );

    await tx.query(
      `INSERT INTO municipality (id, tenant_id, codigo_dane, nombre, departamento, codigo_dane_departamento)
       VALUES ($1, $2, $3, 'Municipio de prueba', 'Departamento de prueba', '11')`,
      [e.municipalityId, e.tenantId, '11001'],
    );

    await tx.query(
      `INSERT INTO ciiu_activity (id, tenant_id, codigo, nombre)
       VALUES ($1, $2, '6201', 'Actividades de desarrollo de sistemas informáticos')`,
      [e.ciiuId, e.tenantId],
    );

    await tx.query(
      `INSERT INTO company (id, tenant_id, nit, razon_social, municipality_id, ciiu_principal_id,
                            es_agente_retencion_renta, buzon_email)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7)`,
      [
        e.companyId,
        e.tenantId,
        `800${s}`,
        `Empresa cliente ${s}`,
        e.municipalityId,
        e.ciiuId,
        `empresa-${s}@inbox.ejemplo.co`,
      ],
    );

    await tx.query(
      `INSERT INTO "user" (id, tenant_id, email, nombre_completo, estado)
       VALUES ($1, $2, $3, $4, 'activo')`,
      [e.userId, e.tenantId, `contador-${s}@ejemplo.co`, `Contador ${s}`],
    );

    await tx.query(
      `INSERT INTO user_company_access (tenant_id, company_id, user_id, role_id)
       VALUES ($1, $2, $3, '00000000-0000-0000-0000-0000000000a3')`,
      [e.tenantId, e.companyId, e.userId],
    );

    await tx.query(
      `INSERT INTO fiscal_period (id, tenant_id, company_id, anio, mes, fecha_inicio, fecha_fin, estado)
       VALUES ($1, $2, $3, 2026, 6, '2026-06-01', '2026-06-30', 'abierto')`,
      [e.fiscalPeriodId, e.tenantId, e.companyId],
    );

    // PUC mínimo. Codificación del Decreto 2650: clase(1) grupo(2) cuenta(4) subcuenta(6).
    await tx.query(
      `INSERT INTO account (id, tenant_id, company_id, codigo, nombre, nivel, naturaleza, permite_movimiento)
       VALUES ($1, $2, $3, '5', 'Gastos', 1, 'debito', false)`,
      [e.cuentas.claseGasto, e.tenantId, e.companyId],
    );
    await tx.query(
      `INSERT INTO account (id, tenant_id, company_id, codigo, nombre, nivel, parent_id, naturaleza, permite_movimiento)
       VALUES ($1, $2, $3, '513595', 'Otros servicios', 4, $4, 'debito', true)`,
      [e.cuentas.gasto, e.tenantId, e.companyId, e.cuentas.claseGasto],
    );
    await tx.query(
      `INSERT INTO account (id, tenant_id, company_id, codigo, nombre, nivel, naturaleza, permite_movimiento)
       VALUES ($1, $2, $3, '240805', 'IVA descontable', 4, 'debito', true)`,
      [e.cuentas.ivaDescontable, e.tenantId, e.companyId],
    );
    await tx.query(
      `INSERT INTO account (id, tenant_id, company_id, codigo, nombre, nivel, naturaleza, permite_movimiento)
       VALUES ($1, $2, $3, '220505', 'Proveedores nacionales', 4, 'credito', true)`,
      [e.cuentas.proveedores, e.tenantId, e.companyId],
    );
    await tx.query(
      `INSERT INTO account (id, tenant_id, company_id, codigo, nombre, nivel, naturaleza, permite_movimiento)
       VALUES ($1, $2, $3, '236540', 'Retención en la fuente por pagar', 4, 'credito', true)`,
      [e.cuentas.retefuentePorPagar, e.tenantId, e.companyId],
    );

    await tx.query(
      `INSERT INTO third_party (id, tenant_id, company_id, numero_documento, tipo_persona,
                                razon_social, municipality_id, codigo_dane)
       VALUES ($1, $2, $3, $4, 'juridica', $5, $6, '11001')`,
      [e.thirdPartyId, e.tenantId, e.companyId, `901${s}`, `Proveedor ${s}`, e.municipalityId],
    );

    await tx.query(
      `INSERT INTO third_party_fiscal_attribute
         (tenant_id, company_id, third_party_id, es_declarante_renta, es_responsable_iva,
          vigente_desde, norma_respaldo, fuente)
       VALUES ($1, $2, $3, true, true, '2020-01-01', 'RUT aportado por el cliente', 'rut')`,
      [e.tenantId, e.companyId, e.thirdPartyId],
    );

    await tx.query(
      `INSERT INTO source_document (id, tenant_id, company_id, tipo_documento, cufe,
                                    numero_documento, emisor_nit, third_party_id,
                                    fecha_hecho_economico, hash_contenido, estado, total_neto)
       VALUES ($1, $2, $3, 'Invoice', $4, $5, $6, $7, '2026-06-15', $8, 'aprobado', 119000000)`,
      [
        e.sourceDocumentId,
        e.tenantId,
        e.companyId,
        `CUFE-${s}`,
        `FE-${s}`,
        `901${s}`,
        e.thirdPartyId,
        `hash-${s}`,
      ],
    );

    await tx.query(
      `INSERT INTO approval (id, tenant_id, company_id, entidad, entidad_id, source_document_id,
                             decision, user_id, ip)
       VALUES ($1, $2, $3, 'source_document', $4, $4, 'aprobado', $5, '192.0.2.10')`,
      [e.approvalId, e.tenantId, e.companyId, e.sourceDocumentId, e.userId],
    );
  });

  return e;
}

export interface PartidaAsiento {
  accountId: string;
  side: 'debito' | 'credito';
  monto: number;
  thirdPartyId?: string;
}

/** Crea un asiento en estado 'draft' con sus partidas. No lo publica. */
export async function crearAsientoBorrador(
  tx: SqlClient,
  e: Escenario,
  partidas: PartidaAsiento[],
  opciones: { descripcion?: string; idempotencyKey?: string } = {},
): Promise<string> {
  const entryId = uuid();
  await tx.query(
    `INSERT INTO journal_entry (id, tenant_id, company_id, fiscal_period_id, fecha_hecho_economico,
                                descripcion, estado, source_document_id, approval_id, idempotency_key, created_by)
     VALUES ($1, $2, $3, $4, '2026-06-15', $5, 'draft', $6, $7, $8, $9)`,
    [
      entryId,
      e.tenantId,
      e.companyId,
      e.fiscalPeriodId,
      opciones.descripcion ?? 'Causación de factura de compra',
      e.sourceDocumentId,
      e.approvalId,
      opciones.idempotencyKey ?? `idem-${entryId}`,
      e.userId,
    ],
  );

  let linea = 0;
  for (const p of partidas) {
    linea += 1;
    await tx.query(
      `INSERT INTO journal_line (tenant_id, company_id, journal_entry_id, linea, account_id,
                                 side, monto, third_party_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        e.tenantId,
        e.companyId,
        entryId,
        linea,
        p.accountId,
        p.side,
        p.monto,
        p.thirdPartyId ?? null,
      ],
    );
  }

  return entryId;
}

/** Publica un asiento borrador. La validación real ocurre en el COMMIT. */
export async function publicarAsiento(
  tx: SqlClient,
  entryId: string,
  userId: string,
): Promise<void> {
  await tx.query('SELECT app.publicar_asiento($1, $2)', [entryId, userId]);
}

/** Partidas de un asiento equilibrado sencillo: gasto contra proveedores. */
export function partidasEquilibradas(e: Escenario, monto = 100_000_00): PartidaAsiento[] {
  return [
    { accountId: e.cuentas.gasto, side: 'debito', monto, thirdPartyId: e.thirdPartyId },
    { accountId: e.cuentas.proveedores, side: 'credito', monto, thirdPartyId: e.thirdPartyId },
  ];
}

// =============================================================================
// Credenciales — añadido por A12 (Ola 0, seguridad)
// =============================================================================

export interface UsuarioConCredencial {
  userId: string;
  email: string;
  password: string;
  /** Secreto TOTP en Base32, si se pidió MFA. */
  secretoTotp?: string;
}

export interface OpcionesUsuario {
  password?: string;
  /** Habilita MFA y devuelve el secreto TOTP en claro para la prueba. */
  conMfa?: boolean;
  /** Clave de aplicación con la que se envuelve el secreto TOTP. */
  claveCifrado?: Buffer;
  estado?: 'activo' | 'suspendido' | 'invitado' | 'inactivo';
  /** Rol de negocio que se le otorga sobre `companyId`. */
  roleId?: string;
  companyId?: string | null;
}

/**
 * Crea un usuario con contraseña derivada con scrypt y, opcionalmente, con
 * segundo factor TOTP cifrado. Devuelve la contraseña y el secreto en claro
 * porque la prueba los necesita para autenticarse; en producción nadie los ve.
 */
export async function crearUsuarioConCredencial(
  db: TestDb,
  tenantId: string,
  opciones: OpcionesUsuario = {},
): Promise<UsuarioConCredencial> {
  const { hashearPassword, ALGORITMO_PASSWORD } = await import('../../src/auth/password.js');
  const { generarSecretoTotp } = await import('../../src/auth/totp.js');
  const { cifrar, ESQUEMA_CIFRADO } = await import('../../src/auth/cifrado.js');

  const s = sufijo();
  const email = `usuario-${s}@ejemplo.co`;
  const password = opciones.password ?? `Contrasena-larga-${s}`;
  const hash = await hashearPassword(password);

  let secretoTotp: string | undefined;
  let secretoCifrado: string | null = null;
  if (opciones.conMfa) {
    if (!opciones.claveCifrado) {
      throw new Error('crearUsuarioConCredencial con MFA necesita claveCifrado.');
    }
    secretoTotp = generarSecretoTotp();
    secretoCifrado = cifrar(secretoTotp, opciones.claveCifrado);
  }

  const userId = await db.asAdmin(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO "user" (tenant_id, email, nombre_completo, estado, password_hash,
                           password_algoritmo, password_actualizado_en,
                           mfa_habilitado, mfa_secret_cifrado, mfa_secret_alg, mfa_confirmado_en)
       VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8, $9, CASE WHEN $7 THEN now() ELSE NULL END)
       RETURNING id`,
      [
        tenantId,
        email,
        `Usuario de prueba ${s}`,
        opciones.estado ?? 'activo',
        hash,
        ALGORITMO_PASSWORD,
        opciones.conMfa === true,
        secretoCifrado,
        opciones.conMfa ? ESQUEMA_CIFRADO : null,
      ],
    );
    const id = rows[0]!.id;

    if (opciones.companyId) {
      await tx.query(
        `INSERT INTO user_company_access (tenant_id, company_id, user_id, role_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (company_id, user_id, role_id) DO NOTHING`,
        [
          tenantId,
          opciones.companyId,
          id,
          opciones.roleId ?? '00000000-0000-0000-0000-0000000000a3',
        ],
      );
    }
    return id;
  });

  return secretoTotp === undefined
    ? { userId, email, password }
    : { userId, email, password, secretoTotp };
}
