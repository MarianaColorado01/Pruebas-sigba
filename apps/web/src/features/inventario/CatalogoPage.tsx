import { useMemo, useState } from 'react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import type { ReferenciaDelCatalogo } from '@/shared/catalogo.ts';
import { useAsignacion } from '@/shared/sesion.ts';
import { useBuscarReferencias } from './useBuscarReferencias.ts';
import { useCatalogo } from './useCatalogo.ts';

export function CatalogoPage() {
  const [texto, setTexto] = useState('');
  const [seleccionada, setSeleccionada] = useState<string>();
  const asignacion = useAsignacion();
  const catalogo = useCatalogo();
  const busqueda = useBuscarReferencias(texto, asignacion?.bancoId ?? null, catalogo.data);

  const referencias = useMemo(() => {
    if (texto.trim()) return busqueda.data?.referencias ?? [];
    return (
      catalogo.data?.catalogo.categorias.flatMap((categoria) =>
        categoria.productos.flatMap((producto) =>
          producto.referencias.map((referencia) => ({
            ...referencia,
            activa: true,
            producto: { id: producto.id, nombre: producto.nombre },
            categoria: {
              id: categoria.id,
              codigo: categoria.codigo,
              nombre: categoria.nombre,
              linea: categoria.linea,
            },
          })),
        ),
      ) ?? []
    );
  }, [busqueda.data, catalogo.data, texto]);

  const grupos = agruparPorCategoria(referencias);
  const buscando = Boolean(texto.trim());
  const cargando = catalogo.isPending || (buscando && busqueda.isPending);
  const desactualizado = buscando
    ? (busqueda.data?.desactualizado ?? (busqueda.isPending && catalogo.data?.desactualizado))
    : catalogo.data?.desactualizado;

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Catálogo de referencias</h1>
        <p className="text-muted-foreground">
          Busca por producto, presentación o código del Banco.
        </p>
      </header>

      <label htmlFor="buscar-referencias" className="flex flex-col gap-2 font-medium">
        Buscar referencia
        <Input
          id="buscar-referencias"
          type="search"
          autoComplete="off"
          placeholder="Ej. arroz, 1 kg o C801"
          value={texto}
          onChange={(evento) => setTexto(evento.target.value)}
        />
      </label>

      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {desactualizado
          ? 'Catálogo guardado; posiblemente desactualizado.'
          : catalogo.isFetching || (buscando && busqueda.isFetching)
            ? 'Actualizando catálogo…'
            : referencias.length === 1
              ? '1 referencia encontrada.'
              : `${referencias.length} referencias encontradas.`}
      </p>

      {(catalogo.isError || busqueda.isError) && referencias.length === 0 && (
        <p role="alert">No se pudo cargar el catálogo. Revisa la conexión e inténtalo de nuevo.</p>
      )}

      {grupos.length === 0 && !cargando && <p>No hay referencias que coincidan con la búsqueda.</p>}

      <div className="flex flex-col gap-5">
        {grupos.map(({ categoria, referencias: delGrupo }) => (
          <section key={categoria.id} aria-labelledby={`categoria-${categoria.id}`}>
            <h2 id={`categoria-${categoria.id}`} className="mb-2 text-lg font-semibold">
              {categoria.codigo ? `${categoria.codigo} · ` : ''}
              {categoria.nombre}
              {categoria.linea ? ` · ${categoria.linea}` : ''}
            </h2>
            <ul className="flex flex-col gap-2">
              {delGrupo.map((referencia) => {
                const nombre = `${referencia.producto.nombre} ${referencia.presentacion}`;
                return (
                  <li key={referencia.id}>
                    <Button
                      type="button"
                      variant={seleccionada === referencia.id ? 'secondary' : 'outline'}
                      className="h-auto min-h-12 w-full justify-start whitespace-normal py-3 text-left"
                      aria-pressed={seleccionada === referencia.id}
                      onClick={() => setSeleccionada(referencia.id)}
                    >
                      {nombre}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {seleccionada && (
        <p role="status" className="sr-only">
          Seleccionaste{' '}
          {referencias.find((referencia) => referencia.id === seleccionada)?.producto.nombre ??
            'una referencia'}
          .
        </p>
      )}
    </main>
  );
}

function agruparPorCategoria(referencias: ReferenciaDelCatalogo[]) {
  const grupos = new Map<
    string,
    { categoria: ReferenciaDelCatalogo['categoria']; referencias: ReferenciaDelCatalogo[] }
  >();
  for (const referencia of referencias) {
    const grupo = grupos.get(referencia.categoria.id) ?? {
      categoria: referencia.categoria,
      referencias: [],
    };
    grupo.referencias.push(referencia);
    grupos.set(referencia.categoria.id, grupo);
  }
  return [...grupos.values()];
}
