import { useState } from 'react';
import type { LoteEnStock } from '@/shared/stock.ts';
import { useStock } from './useStock.ts';

const TODAS = '';

const ESTADOS: Record<LoteEnStock['estado'], string> = {
  vencido: 'Vencido',
  vigente: 'Vigente',
  sin_vencimiento: 'Sin vencimiento',
};

const HORA = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
const NUMERO = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 });

const CLASE_DE_SELECT =
  'h-11 w-full rounded-md border border-input bg-input/20 px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 md:text-sm dark:bg-input/30';

export function StockPage() {
  const stock = useStock();
  const [bodegaId, setBodegaId] = useState(TODAS);
  const [categoriaId, setCategoriaId] = useState(TODAS);
  const [referenciaId, setReferenciaId] = useState(TODAS);

  const lotes = stock.data?.lotes ?? [];
  const bodegas = [...new Set(lotes.map((lote) => lote.bodegaId))].toSorted();
  const categorias = unicas(lotes.map((lote) => lote.referencia.categoria));
  const referencias = unicas(
    lotes
      .filter((lote) => !categoriaId || lote.referencia.categoria.id === categoriaId)
      .map((lote) => lote.referencia),
  );
  const visibles = lotes.filter(
    (lote) =>
      (!bodegaId || lote.bodegaId === bodegaId) &&
      (!categoriaId || lote.referencia.categoria.id === categoriaId) &&
      (!referenciaId || lote.referencia.id === referenciaId),
  );
  const grupos = agruparPorReferencia(visibles);

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Stock por bodega</h1>
        <p className="text-muted-foreground">Qué hay en cada bodega y en qué lote.</p>
      </header>

      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {stock.data
          ? `Última sincronización: ${HORA.format(new Date(stock.data.obtenidoEn))}${
              stock.data.desactualizado ? ' · posiblemente desactualizado' : ''
            }`
          : stock.isPending
            ? 'Consultando stock…'
            : ''}
      </p>

      {stock.isError && !stock.data && (
        <p role="alert">No se pudo consultar el stock. Revisa la conexión e inténtalo de nuevo.</p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-2 font-medium">
          Bodega
          <select
            className={CLASE_DE_SELECT}
            value={bodegaId}
            onChange={(evento) => setBodegaId(evento.target.value)}
          >
            <option value={TODAS}>Todas</option>
            {bodegas.map((id) => (
              <option key={id} value={id}>
                {nombreDeBodega(id)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 font-medium">
          Categoría
          <select
            className={CLASE_DE_SELECT}
            value={categoriaId}
            onChange={(evento) => {
              setCategoriaId(evento.target.value);
              setReferenciaId(TODAS);
            }}
          >
            <option value={TODAS}>Todas</option>
            {categorias.map((categoria) => (
              <option key={categoria.id} value={categoria.id}>
                {categoria.codigo ? `${categoria.codigo} · ` : ''}
                {categoria.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 font-medium">
          Referencia
          <select
            className={CLASE_DE_SELECT}
            value={referenciaId}
            onChange={(evento) => setReferenciaId(evento.target.value)}
          >
            <option value={TODAS}>Todas</option>
            {referencias.map((referencia) => (
              <option key={referencia.id} value={referencia.id}>
                {referencia.producto.nombre} {referencia.presentacion}
              </option>
            ))}
          </select>
        </label>
      </div>

      {stock.data && grupos.length === 0 && <p>No hay stock disponible con esos filtros.</p>}

      <div className="flex flex-col gap-5">
        {grupos.map(({ referencia, lotes: delGrupo }) => (
          <section key={referencia.id} aria-labelledby={`stock-${referencia.id}`}>
            <h2 id={`stock-${referencia.id}`} className="text-lg font-semibold">
              {referencia.producto.nombre} {referencia.presentacion}
            </h2>
            <p className="mb-2 text-sm text-muted-foreground">
              {referencia.categoria.codigo ? `${referencia.categoria.codigo} · ` : ''}
              {referencia.categoria.nombre} · {cantidad(sumar(delGrupo, 'cantidad'))} en total (
              {NUMERO.format(sumar(delGrupo, 'kilos'))} kg)
            </p>
            <ul className="flex flex-col gap-2">
              {delGrupo.map((lote) => (
                <li
                  key={`${lote.bodegaId}/${lote.loteId}`}
                  className="flex flex-col gap-1 rounded-md border border-input p-3"
                >
                  <span className="font-medium">
                    {lote.codigo ? `Lote ${lote.codigo}` : 'Lote sin código'} ·{' '}
                    {nombreDeBodega(lote.bodegaId)}
                  </span>
                  <span>
                    {lote.vencimiento ? `Vence ${fecha(lote.vencimiento)}` : 'Sin fecha'} ·{' '}
                    {ESTADOS[lote.estado]}
                  </span>
                  <span>
                    {cantidad(Number(lote.cantidad))} · {NUMERO.format(Number(lote.kilos))} kg
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}

/**
 * Plataforma todavía no expone el nombre de las bodegas a otros módulos
 * (SBA-34); mientras tanto se muestra el comienzo del id.
 */
function nombreDeBodega(id: string): string {
  return `Bodega ${id.slice(0, 8)}`;
}

/** AAAA-MM-DD a DD/MM/AAAA sin pasar por Date, que lo correría de día según la zona. */
function fecha(vencimiento: string): string {
  const [anio, mes, dia] = vencimiento.split('-');
  return `${dia}/${mes}/${anio}`;
}

function cantidad(unidades: number): string {
  return `${NUMERO.format(unidades)} ${unidades === 1 ? 'unidad' : 'unidades'}`;
}

function sumar(lotes: LoteEnStock[], campo: 'cantidad' | 'kilos'): number {
  return lotes.reduce((total, lote) => total + Number(lote[campo]), 0);
}

function unicas<T extends { id: string }>(elementos: T[]): T[] {
  return [...new Map(elementos.map((elemento) => [elemento.id, elemento])).values()];
}

/** La API ya los entrega ordenados por producto; el grupo respeta ese orden. */
function agruparPorReferencia(lotes: LoteEnStock[]) {
  const grupos = new Map<string, { referencia: LoteEnStock['referencia']; lotes: LoteEnStock[] }>();
  for (const lote of lotes) {
    const grupo = grupos.get(lote.referencia.id) ?? { referencia: lote.referencia, lotes: [] };
    grupo.lotes.push(lote);
    grupos.set(lote.referencia.id, grupo);
  }
  return [...grupos.values()];
}
