import { useState } from 'react';
import type { LoteEnStock } from '@/shared/stock.ts';
import { useStock } from './useStock.ts';

const TODAS = '';

const ESTADOS: Record<LoteEnStock['estado'], string> = {
  vencido: 'Vencido',
  vigente: 'Vigente',
  sin_vencimiento: 'Sin vencimiento',
};

type Semaforo = NonNullable<LoteEnStock['semaforo']>;

const SEMAFOROS: Record<Semaforo, { nombre: string; color: string }> = {
  rojo: { nombre: 'Rojo', color: 'bg-red-600' },
  amarillo: { nombre: 'Amarillo', color: 'bg-yellow-400' },
  verde: { nombre: 'Verde', color: 'bg-green-600' },
};

/** «Este mes» son los próximos 30 días; rojo y amarillo los fija el banco. */
const DIAS_DEL_MES = 30;

const LISTAS_DE_SALIDA: { titulo: string; incluye: (lote: LoteEnStock) => boolean }[] = [
  { titulo: 'Sale hoy', incluye: (lote) => lote.semaforo === 'rojo' },
  { titulo: 'Sale esta semana', incluye: (lote) => lote.semaforo === 'amarillo' },
  {
    titulo: 'Sale este mes',
    incluye: (lote) =>
      lote.semaforo === 'verde' && (lote.diasParaVencer ?? Infinity) <= DIAS_DEL_MES,
  },
];

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
  // Primero lo que vence primero (FEFO), sin importar la bodega.
  const porVencimiento = visibles
    .filter((lote) => lote.semaforo !== null)
    .toSorted((a, b) => (a.diasParaVencer ?? 0) - (b.diasParaVencer ?? 0));
  const listas = LISTAS_DE_SALIDA.map((lista) => ({
    ...lista,
    lotes: porVencimiento.filter(lista.incluye),
  })).filter((lista) => lista.lotes.length > 0);
  const sinUmbrales =
    porVencimiento.length === 0 && visibles.some((lote) => lote.estado === 'vigente');

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

      {grupos.length > 0 && (
        <section aria-labelledby="salida-prioritaria" className="flex flex-col gap-3">
          <h2 id="salida-prioritaria" className="text-lg font-semibold">
            Salida prioritaria
          </h2>
          {sinUmbrales ? (
            <p className="text-sm text-muted-foreground">
              El banco no tiene umbrales de semáforo. La administración del banco los fija en
              Parámetros.
            </p>
          ) : listas.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ningún lote vence en los próximos 30 días.
            </p>
          ) : (
            listas.map(({ titulo, lotes: deLaLista }) => (
              <div key={titulo} className="flex flex-col gap-2">
                <h3 className="font-medium">{titulo}</h3>
                <ul className="flex flex-col gap-2">
                  {deLaLista.map((lote) => (
                    <li
                      key={`${lote.bodegaId}/${lote.loteId}`}
                      className="flex flex-col gap-1 rounded-md border border-input p-3"
                    >
                      <span className="font-medium">
                        {lote.referencia.producto.nombre} {lote.referencia.presentacion} ·{' '}
                        {lote.codigo ? `Lote ${lote.codigo}` : 'Lote sin código'}
                      </span>
                      <span>
                        {faltan(lote.diasParaVencer ?? 0)} · {nombreDeBodega(lote.bodegaId)} ·{' '}
                        {cantidad(Number(lote.cantidad))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
      )}

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
                  <span className="flex items-center gap-2">
                    {lote.semaforo && (
                      <span
                        aria-hidden="true"
                        className={`size-3 rounded-full ${SEMAFOROS[lote.semaforo].color}`}
                      />
                    )}
                    {lote.vencimiento ? `Vence ${fecha(lote.vencimiento)}` : 'Sin fecha'} ·{' '}
                    {ESTADOS[lote.estado]}
                    {lote.semaforo && ` · ${SEMAFOROS[lote.semaforo].nombre}`}
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

function faltan(dias: number): string {
  if (dias === 0) return 'Vence hoy';
  if (dias === 1) return 'Vence mañana';
  return `Vence en ${dias} días`;
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
