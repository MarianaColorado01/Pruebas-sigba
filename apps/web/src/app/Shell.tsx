import {
  Building03Icon,
  Home01Icon,
  Logout01Icon,
  PackageReceiveIcon,
  PackageRemoveIcon,
  MoneyBag02Icon,
  Building06Icon,
  DeliveryTruck01Icon,
  UnfoldMoreIcon,
  UserGroupIcon,
  WarehouseIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import type { Rol } from '@sigba/shared-types';
import { cn } from 'cn';
import { Link, NavLink, Outlet } from 'react-router';
import { useCola } from '@/offline/cola.ts';
import { SoloPara } from '@/shared/SoloPara.tsx';
import { Button } from '@/ui/button';
import { NOMBRE_DE_ROL, nombreDeOpcion } from './eleccionDeBanco.ts';
import { InsigniaDeBanco } from './SelectorDeBanco.tsx';
import { useBancoActivo, useCerrarSesion } from './sesionActiva.ts';

interface Destino {
  a: string;
  etiqueta: string;
  icono: IconSvgElement;
  /** Sin roles, lo ve cualquiera con banco. Los mismos que exige `@Roles()` en la API. */
  roles?: readonly Rol[];
}

const DESTINOS: readonly Destino[] = [
  { a: '/', etiqueta: 'Inicio', icono: Home01Icon },
  {
    a: '/salidas/nueva',
    etiqueta: 'Salida',
    icono: DeliveryTruck01Icon,
    roles: ['operario_bodega', 'voluntario', 'coordinacion', 'admin_banco'],
  },
  {
    a: '/beneficiarios/instituciones',
    etiqueta: 'Instituciones',
    icono: Building03Icon,
    roles: ['admin_banco', 'coordinacion'],
  },
  {
    a: '/recepcion',
    etiqueta: 'Recepción',
    icono: PackageReceiveIcon,
    roles: ['operario_bodega', 'coordinacion', 'admin_banco'],
  },
  {
    a: '/bajas',
    etiqueta: 'Bajas',
    icono: PackageRemoveIcon,
    roles: ['coordinacion', 'admin_banco'],
  },
  {
    a: '/precios',
    etiqueta: 'Precios',
    icono: MoneyBag02Icon,
    roles: ['coordinacion', 'admin_banco'],
  },
  { a: '/plataforma/bodegas', etiqueta: 'Bodegas', icono: WarehouseIcon, roles: ['admin_banco'] },
  { a: '/plataforma/usuarios', etiqueta: 'Usuarios', icono: UserGroupIcon, roles: ['admin_banco'] },
  { a: '/plataforma/bancos', etiqueta: 'Bancos', icono: Building06Icon, roles: ['super_admin'] },
];

function Enlaces({ forma }: { forma: 'lateral' | 'inferior' }) {
  return DESTINOS.map(({ a, etiqueta, icono, roles }) => {
    const enlace = (
      <NavLink
        key={a}
        to={a}
        end={a === '/'}
        className={({ isActive }) =>
          cn(
            'flex items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
            forma === 'lateral'
              ? 'min-h-11 gap-3 px-3 text-sm hover:bg-sidebar-accent'
              : 'min-h-14 flex-1 flex-col justify-center gap-0.5 text-xs',
            isActive
              ? 'font-medium text-foreground ' + (forma === 'lateral' ? 'bg-sidebar-accent' : '')
              : 'text-muted-foreground',
          )
        }
      >
        <HugeiconsIcon icon={icono} size={forma === 'lateral' ? 18 : 22} aria-hidden />
        {etiqueta}
      </NavLink>
    );
    return roles ? (
      <SoloPara key={a} roles={roles}>
        {enlace}
      </SoloPara>
    ) : (
      enlace
    );
  });
}

/** Banco y rol de la sesión. Con más de una opción, abre el selector. */
function BotonDeBanco({ compacto = false }: { compacto?: boolean }) {
  const { activa, opciones, cambiar } = useBancoActivo();
  const puedeCambiar = opciones.length > 1;
  const contenido = (
    <>
      <InsigniaDeBanco opcion={activa} />
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="truncate text-sm font-medium">{nombreDeOpcion(activa)}</span>
        {!compacto && (
          <span className="truncate text-xs text-muted-foreground">
            {NOMBRE_DE_ROL[activa.rol]}
          </span>
        )}
      </span>
    </>
  );

  if (!puedeCambiar)
    return <div className="flex min-h-11 items-center gap-2.5 px-1">{contenido}</div>;

  return (
    <button
      type="button"
      onClick={cambiar}
      aria-label={`Cambiar de banco. Ahora: ${nombreDeOpcion(activa)}`}
      className="flex min-h-11 min-w-0 items-center gap-2.5 rounded-md px-1 outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      {contenido}
      <HugeiconsIcon
        icon={UnfoldMoreIcon}
        size={16}
        className="text-muted-foreground"
        aria-hidden
      />
    </button>
  );
}

/**
 * Cuántos registros de este celular faltan por llegar a la API o los rechazó.
 * No se muestra si no hay ninguno.
 */
function IndicadorDeCola() {
  const { comandos } = useCola();
  const enConflicto = comandos.filter((comando) => comando.estado === 'conflicto').length;
  const pendientes = comandos.filter(
    (comando) => comando.estado === 'pendiente' || comando.estado === 'enviado',
  ).length;
  if (enConflicto === 0 && pendientes === 0) return null;

  const partes = [
    pendientes > 0 && `${pendientes} por sincronizar`,
    enConflicto > 0 && `${enConflicto} en conflicto`,
  ].filter(Boolean);
  return (
    <Link
      to="/sincronizacion"
      className={cn(
        'flex min-h-11 items-center rounded-md px-3 text-sm font-medium outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/40',
        enConflicto > 0 && 'text-destructive',
      )}
    >
      {partes.join(' · ')}
    </Link>
  );
}

/**
 * Marco de la PWA con banco elegido. En el celular, banco arriba y destinos
 * en una barra inferior al alcance del pulgar; en escritorio, una columna
 * lateral como la de Linear. Los destinos dependen del rol activo.
 */
export function Shell() {
  const cerrarSesion = useCerrarSesion();

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[16rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-4 border-r bg-sidebar p-3 md:flex">
        <BotonDeBanco />
        <nav aria-label="Principal" className="flex flex-col gap-0.5">
          <Enlaces forma="lateral" />
        </nav>
        <IndicadorDeCola />
        <Button variant="ghost" className="mt-auto justify-start" onClick={cerrarSesion}>
          <HugeiconsIcon icon={Logout01Icon} aria-hidden />
          Cerrar sesión
        </Button>
      </aside>

      <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-2 border-b bg-background/95 px-3 backdrop-blur md:hidden">
        <BotonDeBanco compacto />
        <IndicadorDeCola />
        <Button variant="ghost" size="icon" aria-label="Cerrar sesión" onClick={cerrarSesion}>
          <HugeiconsIcon icon={Logout01Icon} aria-hidden />
        </Button>
      </header>

      <main className="pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
        <Outlet />
      </main>

      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-10 flex border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <Enlaces forma="inferior" />
      </nav>
    </div>
  );
}
