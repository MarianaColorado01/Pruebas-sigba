import { ArrowRight01Icon, Store01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { BodegaDto } from '@sigba/shared-types';
import { type FormEvent, useState } from 'react';
import { tieneRol, useAsignacion } from '@/shared/sesion';
import { HojaDeEdicion } from '@/ui/HojaDeEdicion';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { mensajeDeError, useBodegas } from './datos.ts';
import { FilaNueva } from './FilaNueva.tsx';

const REPETIDA = 'Ya hay una bodega con ese nombre en este banco.';

/**
 * Bodegas del banco (SBA-19, D10). La lista es la pantalla: se crea en la
 * última fila y se edita en una hoja. Los demás roles de banco la ven sin
 * poder cambiarla.
 */
export function PantallaBodegas() {
  const administra = tieneRol(useAsignacion(), ['admin_banco']);
  const { lista, crear } = useBodegas();
  const [verTodas, setVerTodas] = useState(false);
  const [editando, setEditando] = useState<BodegaDto | null>(null);
  const [errorAlCrear, setErrorAlCrear] = useState<string | null>(null);

  const bodegas = lista.data ?? [];
  const activas = bodegas.filter((b) => b.activa);
  const visibles = verTodas ? bodegas : activas;
  const inactivas = bodegas.length - activas.length;

  async function guardarNueva(datos: FormData): Promise<boolean> {
    const nombre = String(datos.get('nombre') ?? '').trim();
    if (!nombre) {
      setErrorAlCrear('Escribe el nombre de la bodega.');
      return false;
    }
    try {
      await crear.mutateAsync({ nombre });
      setErrorAlCrear(null);
      return true;
    } catch (error) {
      setErrorAlCrear(mensajeDeError(error, REPETIDA));
      return false;
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-5 px-4 pt-6 pb-24 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bodegas</h1>
          <p className="text-sm text-muted-foreground">
            {lista.isPending
              ? 'Cargando…'
              : `${activas.length} ${activas.length === 1 ? 'activa' : 'activas'}` +
                (inactivas ? ` · ${inactivas} sin uso` : '')}
          </p>
        </div>
        {inactivas > 0 && (
          <div
            role="group"
            aria-label="Qué bodegas mostrar"
            className="flex rounded-lg bg-muted p-1"
          >
            {[
              { valor: false, texto: 'Activas' },
              { valor: true, texto: 'Todas' },
            ].map(({ valor, texto }) => (
              <button
                key={texto}
                type="button"
                aria-pressed={verTodas === valor}
                onClick={() => setVerTodas(valor)}
                className="min-h-11 rounded-md px-4 text-sm font-medium text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
              >
                {texto}
              </button>
            ))}
          </div>
        )}
      </header>

      {lista.isError && (
        <p role="alert" className="text-sm text-destructive">
          No se pudo cargar la lista. Revisa la señal y vuelve a intentarlo.
        </p>
      )}

      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {visibles.map((bodega) => (
          <li key={bodega.id}>
            <FilaDeBodega
              bodega={bodega}
              onAbrir={administra ? () => setEditando(bodega) : undefined}
            />
          </li>
        ))}
        {administra && (
          <li>
            <FilaNueva
              etiqueta={bodegas.length ? 'Nueva bodega' : 'Agrega la primera bodega'}
              error={errorAlCrear}
              guardando={crear.isPending}
              onGuardar={guardarNueva}
              campos={
                <Input
                  name="nombre"
                  aria-label="Nombre de la bodega"
                  placeholder="Nombre de la bodega"
                  maxLength={80}
                  autoFocus
                />
              }
            />
          </li>
        )}
        {!administra && !lista.isPending && bodegas.length === 0 && (
          <li className="px-4 py-6 text-sm text-muted-foreground">
            El banco aún no tiene bodegas. Las crea la administración del banco.
          </li>
        )}
      </ul>

      {editando && (
        <EdicionDeBodega
          key={editando.id}
          bodega={bodegas.find((b) => b.id === editando.id) ?? editando}
          onCerrar={() => setEditando(null)}
        />
      )}
    </main>
  );
}

function FilaDeBodega({ bodega, onAbrir }: { bodega: BodegaDto; onAbrir?: () => void }) {
  const contenido = (
    <>
      <span
        className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
          bodega.activa ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
        }`}
      >
        <HugeiconsIcon icon={Store01Icon} size={16} aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`truncate font-medium ${bodega.activa ? '' : 'text-muted-foreground'}`}>
          {bodega.nombre}
        </span>
        {bodega.direccion && (
          <span className="truncate text-sm text-muted-foreground">{bodega.direccion}</span>
        )}
      </span>
      {!bodega.activa && (
        <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
          Sin uso
        </span>
      )}
      {onAbrir && (
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={18}
          className="text-muted-foreground"
          aria-hidden
        />
      )}
    </>
  );
  const clases = 'flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left';

  return onAbrir ? (
    <button
      type="button"
      onClick={onAbrir}
      className={`${clases} transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none`}
    >
      {contenido}
    </button>
  ) : (
    <div className={clases}>{contenido}</div>
  );
}

function EdicionDeBodega({ bodega, onCerrar }: { bodega: BodegaDto; onCerrar: () => void }) {
  const { editar, cambiarEstado } = useBodegas();
  const [error, setError] = useState<string | null>(null);

  async function guardar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = new FormData(evento.currentTarget);
    const nombre = String(datos.get('nombre') ?? '').trim();
    if (!nombre) {
      setError('La bodega necesita un nombre.');
      return;
    }
    try {
      await editar.mutateAsync({
        id: bodega.id,
        cambios: { nombre, direccion: String(datos.get('direccion') ?? '').trim() || null },
      });
      onCerrar();
    } catch (causa) {
      setError(mensajeDeError(causa, REPETIDA));
    }
  }

  async function alternarEstado() {
    try {
      await cambiarEstado.mutateAsync({ id: bodega.id, activa: !bodega.activa });
      setError(null);
    } catch (causa) {
      setError(mensajeDeError(causa, REPETIDA));
    }
  }

  return (
    <HojaDeEdicion
      abierta
      onCerrar={onCerrar}
      titulo={bodega.nombre}
      descripcion={bodega.activa ? 'Bodega activa' : 'Sin uso: no se ofrece para movimientos'}
    >
      <form onSubmit={guardar} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="bodega-nombre">Nombre</Label>
          <Input id="bodega-nombre" name="nombre" defaultValue={bodega.nombre} maxLength={80} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="bodega-direccion">Dirección (opcional)</Label>
          <Input
            id="bodega-direccion"
            name="direccion"
            defaultValue={bodega.direccion ?? ''}
            maxLength={200}
          />
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
          {bodega.activa
            ? 'Si la dejas sin uso, no se ofrece para recepciones ni salidas nuevas. El stock que tenga sigue a la vista.'
            : 'Al reactivarla vuelve a ofrecerse para movimientos nuevos.'}
        </p>
        <Button
          type="button"
          variant={bodega.activa ? 'destructive' : 'outline'}
          disabled={cambiarEstado.isPending}
          onClick={alternarEstado}
        >
          {bodega.activa ? 'Dejar sin uso' : 'Reactivar'}
        </Button>
      </section>
    </HojaDeEdicion>
  );
}
