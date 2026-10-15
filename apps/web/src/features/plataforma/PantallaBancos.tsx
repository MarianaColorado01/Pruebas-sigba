import { ArrowRight01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { BancoDto } from '@sigba/shared-types';
import { type FormEvent, useState } from 'react';
import { tieneRol, useAsignacion } from '@/shared/sesion';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { mensajeDeError, useBancos } from './datos.ts';
import { FilaNueva } from './FilaNueva.tsx';
import { HojaDeEdicion } from './HojaDeEdicion.tsx';

const REPETIDO = 'Ya hay un banco con ese código en la red.';
const FORMA_DE_CODIGO = /^[A-Z0-9-]{1,20}$/;

/** El código como lo guarda la API: sin espacios a los lados y en mayúsculas. */
const codigoDe = (datos: FormData) =>
  String(datos.get('codigo') ?? '')
    .trim()
    .toUpperCase();

/**
 * Bancos de la red ABACO (SBA-19, D11). Solo `super_admin`. El código va
 * delante, como el identificador de un issue en Linear: es lo que se reconoce
 * de un vistazo.
 */
export function PantallaBancos() {
  const deLaRed = tieneRol(useAsignacion(), ['super_admin']);

  if (!deLaRed) {
    return (
      <main className="mx-auto max-w-2xl px-4 pt-6 sm:px-6">
        <p className="text-sm text-muted-foreground">
          Los bancos los administra la red. Tu rol no tiene acceso a esta pantalla.
        </p>
      </main>
    );
  }
  return <ListaDeBancos />;
}

function ListaDeBancos() {
  const { lista, crear } = useBancos();
  const [editando, setEditando] = useState<string | null>(null);
  const [errorAlCrear, setErrorAlCrear] = useState<string | null>(null);

  const bancos = lista.data ?? [];
  const activos = bancos.filter((b) => b.activo).length;
  const abierto = bancos.find((b) => b.id === editando);

  async function guardarNuevo(datos: FormData): Promise<boolean> {
    const codigo = codigoDe(datos);
    const nombre = String(datos.get('nombre') ?? '').trim();
    if (!FORMA_DE_CODIGO.test(codigo) || !nombre) {
      setErrorAlCrear('Escribe código y nombre. El código lleva letras, dígitos o guiones.');
      return false;
    }
    try {
      await crear.mutateAsync({ codigo, nombre });
      setErrorAlCrear(null);
      return true;
    } catch (error) {
      setErrorAlCrear(mensajeDeError(error, REPETIDO));
      return false;
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-5 px-4 pt-6 pb-24 sm:px-6">
      <header>
        <p className="text-sm font-medium text-muted-foreground">Red ABACO</p>
        <h1 className="text-2xl font-semibold tracking-tight">Bancos</h1>
        <p className="text-sm text-muted-foreground">
          {lista.isPending
            ? 'Cargando…'
            : `${activos} en operación` +
              (bancos.length > activos ? ` · ${bancos.length - activos} desactivados` : '')}
        </p>
      </header>

      {lista.isError && (
        <p role="alert" className="text-sm text-destructive">
          No se pudo cargar la lista. Revisa la señal y vuelve a intentarlo.
        </p>
      )}

      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {bancos.map((banco) => (
          <li key={banco.id}>
            <button
              type="button"
              onClick={() => setEditando(banco.id)}
              className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none"
            >
              <span
                className={`w-24 shrink-0 truncate font-mono text-sm ${
                  banco.activo ? 'text-foreground' : 'text-muted-foreground line-through'
                }`}
              >
                {banco.codigo}
              </span>
              <span
                className={`min-w-0 flex-1 truncate ${banco.activo ? 'font-medium' : 'text-muted-foreground'}`}
              >
                {banco.nombre}
              </span>
              {!banco.activo && (
                <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                  Desactivado
                </span>
              )}
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                size={18}
                className="text-muted-foreground"
                aria-hidden
              />
            </button>
          </li>
        ))}
        <li>
          <FilaNueva
            etiqueta="Nuevo banco"
            error={errorAlCrear}
            guardando={crear.isPending}
            onGuardar={guardarNuevo}
            campos={
              <>
                <Input
                  name="codigo"
                  aria-label="Código del banco"
                  placeholder="BAP"
                  maxLength={20}
                  autoFocus
                  autoCapitalize="characters"
                  className="font-mono uppercase sm:w-32"
                />
                <Input
                  name="nombre"
                  aria-label="Nombre del banco"
                  placeholder="Banco de Alimentos"
                />
              </>
            }
          />
        </li>
      </ul>

      {abierto && (
        <EdicionDeBanco key={abierto.id} banco={abierto} onCerrar={() => setEditando(null)} />
      )}
    </main>
  );
}

function EdicionDeBanco({ banco, onCerrar }: { banco: BancoDto; onCerrar: () => void }) {
  const { editar, cambiarEstado } = useBancos();
  const [error, setError] = useState<string | null>(null);

  async function guardar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = new FormData(evento.currentTarget);
    const codigo = codigoDe(datos);
    const nombre = String(datos.get('nombre') ?? '').trim();
    if (!FORMA_DE_CODIGO.test(codigo) || !nombre) {
      setError('Revisa código y nombre. El código lleva letras, dígitos o guiones.');
      return;
    }
    try {
      await editar.mutateAsync({ id: banco.id, cambios: { codigo, nombre } });
      onCerrar();
    } catch (causa) {
      setError(mensajeDeError(causa, REPETIDO));
    }
  }

  async function alternarEstado() {
    try {
      await cambiarEstado.mutateAsync({ id: banco.id, activo: !banco.activo });
      setError(null);
    } catch (causa) {
      setError(mensajeDeError(causa, REPETIDO));
    }
  }

  return (
    <HojaDeEdicion
      abierta
      onCerrar={onCerrar}
      titulo={banco.nombre}
      descripcion={banco.activo ? 'En operación' : 'Desactivado: sus usuarios no pueden entrar'}
    >
      <form onSubmit={guardar} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="banco-codigo">Código</Label>
          <Input
            id="banco-codigo"
            name="codigo"
            defaultValue={banco.codigo}
            maxLength={20}
            autoCapitalize="characters"
            className="font-mono uppercase"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="banco-nombre">Nombre</Label>
          <Input id="banco-nombre" name="nombre" defaultValue={banco.nombre} maxLength={200} />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={editar.isPending}>
          {editar.isPending ? 'Guardando…' : 'Guardar cambios'}
        </Button>
      </form>

      <section className="flex flex-col gap-3 border-t pt-6">
        <p className="text-sm text-muted-foreground">
          {banco.activo
            ? 'Al desactivarlo, nadie del banco puede entrar. Sus datos no se borran.'
            : 'Al reactivarlo, sus usuarios vuelven a entrar con las asignaciones que tenían.'}
        </p>
        <Button
          type="button"
          variant={banco.activo ? 'destructive' : 'outline'}
          disabled={cambiarEstado.isPending}
          onClick={alternarEstado}
        >
          {banco.activo ? 'Desactivar banco' : 'Reactivar banco'}
        </Button>
      </section>
    </HojaDeEdicion>
  );
}
