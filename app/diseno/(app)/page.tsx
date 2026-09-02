import Link from 'next/link';
import { Encabezado } from '../_ui/componentes';

const PANTALLAS: ReadonlyArray<{ href: string; titulo: string; nota: string }> = [
  { href: '/diseno/bandeja', titulo: 'Bandeja de causación', nota: 'Cola de trabajo tipo inbox: aprobar, corregir o rechazar el asiento propuesto.' },
  { href: '/diseno/terceros', titulo: 'Terceros', nota: 'Maestro de proveedores/clientes, atributos fiscales con vigencia y cascada municipio→actividad.' },
  { href: '/diseno/parametros', titulo: 'Parámetros tributarios', nota: 'Tarifas, UVT, SMMLV y calendario con vigencia; alertas de dato pendiente.' },
  { href: '/diseno/parametros/puc', titulo: 'PUC / Plan de cuentas', nota: 'PUC genérico + personalizado por empresa, cuenta por cuenta.' },
  { href: '/diseno/reportes', titulo: 'Reportes', nota: 'Libros contables y exógena, con los tres estados de mensaje diferenciados.' },
  { href: '/diseno/admin/usuarios', titulo: 'Administración · Usuarios', nota: 'Alta, estado activo/inactivo y restablecer contraseña.' },
  { href: '/diseno/admin/roles', titulo: 'Administración · Roles', nota: 'Matriz de permisos módulo × acción; rol todopoderoso bloqueado.' },
  { href: '/diseno/admin/correcciones', titulo: 'Administración · Correcciones', nota: 'Bandeja de correcciones por revisar, mismo patrón que la de causación.' },
];

export default function IndiceDiseno() {
  return (
    <div className="p-5">
      <Encabezado
        titulo="Sistema de interfaz — Ola 5 (D-075)"
        descripcion="Prototipo navegable de la Dirección A «Consola de operación». Login en /diseno/entrar."
      />
      <ul className="grid grid-cols-2 gap-3">
        {PANTALLAS.map((p) => (
          <li key={p.href}>
            <Link
              href={p.href}
              className="flex h-full flex-col gap-1 rounded-lg border border-borde bg-superficie-elevada p-4 hover:border-primario"
            >
              <span className="text-[14px] font-semibold text-texto">{p.titulo}</span>
              <span className="text-[12px] text-texto-suave">{p.nota}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
