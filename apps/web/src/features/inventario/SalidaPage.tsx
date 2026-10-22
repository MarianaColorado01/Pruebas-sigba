import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ErrorDeApi } from '@/shared/clienteHttp.ts';
import type { ComandoDeSalida, InstitucionActiva, Salida } from '@/shared/salidas.ts';
import { usePedir } from '@/shared/sesion.ts';
import type { LoteEnStock } from '@/shared/stock.ts';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { nuevoComandoDeSalida, registrarSalida } from './registrarSalida.ts';
import { STOCK_QUERY_KEY, useStock } from './useStock.ts';

interface Fila {
  clave: number;
  referenciaId: string;
  loteId: string;
  cantidad: string;
}

const NUMERO = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 });
const PESOS = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 2,
});

const CLASE_DE_SELECT =
  'h-11 w-full rounded-md border border-input bg-input/20 px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 md:text-sm dark:bg-input/30';

let siguienteClave = 0;
const filaVacia = (): Fila => ({
  clave: ++siguienteClave,
  referenciaId: '',
  loteId: '',
  cantidad: '',
});

/**
 * Salida a institución desde el celular (SBA-38). Quien despacha elige la
 * institución, la bodega y, por referencia, el lote y la cantidad. El lote
 * sugerido es el que vence primero (FEFO) y se puede cambiar. Lo vencido no
 * aparece: se da de baja.
 *
 * Por ahora va en línea. Mientras la API no responde, la salida dice
 * «pendiente de sincronizar» (ADR-10); reintentar manda el mismo comando.
 */
export function SalidaPage() {
  const pedir = usePedir();
  const cliente = useQueryClient();
  const stock = useStock();
  const instituciones = useQuery({
    queryKey: ['inventario', 'salidas', 'instituciones'],
    queryFn: () => pedir<InstitucionActiva[]>('/salidas/instituciones'),
  });

  const [institucionId, setInstitucionId] = useState('');
  const [bodegaId, setBodegaId] = useState('');
  const [despachador, setDespachador] = useState('');
  const [despachadorTipo, setDespachadorTipo] =
    useState<ComandoDeSalida['despachadorTipo']>('funcionario');
  const [filas, setFilas] = useState<Fila[]>(() => [filaVacia()]);
  /** Se conserva entre reintentos; cambia si cambia lo que se va a despachar. */
  const [comando, setComando] = useState<ComandoDeSalida | null>(null);
  const [pendiente, setPendiente] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [registrada, setRegistrada] = useState<Salida | null>(null);

  const disponibles = (stock.data?.lotes ?? [])
    .filter((lote) => lote.estado !== 'vencido')
    .toSorted(porVencimiento);
  const bodegas = [...new Set(disponibles.map((lote) => lote.bodegaId))].toSorted();
  const enBodega = disponibles.filter((lote) => lote.bodegaId === bodegaId);
  const referencias = [
    ...new Map(enBodega.map((lote) => [lote.referencia.id, lote.referencia])).values(),
  ];

  function editar(cambio: () => void) {
    cambio();
    setComando(null);
    setAviso(null);
  }

  function cambiarFila(clave: number, cambios: Partial<Fila>) {
    editar(() =>
      setFilas((actuales) => actuales.map((f) => (f.clave === clave ? { ...f, ...cambios } : f))),
    );
  }

  function elegirReferencia(clave: number, referenciaId: string) {
    // FEFO: el primero de la lista es el que vence primero.
    const sugerido = enBodega.find((lote) => lote.referencia.id === referenciaId);
    cambiarFila(clave, { referenciaId, loteId: sugerido?.loteId ?? '' });
  }

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    const aEnviar =
      comando ??
      nuevoComandoDeSalida({
        institucionId,
        bodegaId,
        despachador,
        despachadorTipo,
        detalles: filas.map(({ referenciaId, loteId, cantidad }) => ({
          referenciaId,
          loteId,
          cantidad: cantidad.trim().replace(',', '.'),
        })),
      });
    setComando(aEnviar);
    setPendiente(true);
    setAviso(null);
    try {
      setRegistrada(await registrarSalida(pedir, aEnviar));
      setFilas([filaVacia()]);
      setComando(null);
    } catch (error) {
      if (error instanceof ErrorDeApi && error.codigo === 'sin_stock') {
        // El stock cambió: otro despacho se llevó parte. Con datos nuevos se
        // corrige y se manda otro comando.
        setComando(null);
        setAviso(
          'No hay stock suficiente en la bodega para esta salida. Revisa las cantidades con el stock actualizado.',
        );
      } else {
        setAviso(motivo(error));
      }
    } finally {
      setPendiente(false);
      await cliente.invalidateQueries({ queryKey: STOCK_QUERY_KEY });
    }
  }

  if (registrada) {
    return (
      <Comprobante
        salida={registrada}
        institucion={instituciones.data?.find((i) => i.id === registrada.institucionId)?.nombre}
        lotes={stock.data?.lotes ?? []}
        onOtra={() => setRegistrada(null)}
      />
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Salida a institución</h1>
        <p className="text-muted-foreground">Registra lo que entregas mientras despachas.</p>
      </header>

      <form onSubmit={enviar} className="flex flex-col gap-4">
        <label className="flex flex-col gap-2 font-medium">
          Institución
          <select
            className={CLASE_DE_SELECT}
            value={institucionId}
            onChange={(evento) => editar(() => setInstitucionId(evento.target.value))}
            required
          >
            <option value="" disabled>
              {instituciones.isPending ? 'Cargando instituciones…' : 'Elige la institución'}
            </option>
            {instituciones.data?.map((institucion) => (
              <option key={institucion.id} value={institucion.id}>
                {institucion.nombre}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-2 font-medium">
          Bodega
          <select
            className={CLASE_DE_SELECT}
            value={bodegaId}
            onChange={(evento) =>
              editar(() => {
                setBodegaId(evento.target.value);
                setFilas([filaVacia()]);
              })
            }
            required
          >
            <option value="" disabled>
              Elige la bodega
            </option>
            {bodegas.map((id) => (
              <option key={id} value={id}>
                {nombreDeBodega(id)}
              </option>
            ))}
          </select>
        </label>

        {filas.map((fila, i) => {
          const lotes = enBodega.filter((lote) => lote.referencia.id === fila.referenciaId);
          return (
            <fieldset key={fila.clave} className="flex flex-col gap-3 rounded-lg border p-3">
              <legend className="px-1 font-medium">Producto {i + 1}</legend>
              <label className="flex flex-col gap-2">
                Referencia
                <select
                  className={CLASE_DE_SELECT}
                  value={fila.referenciaId}
                  onChange={(evento) => elegirReferencia(fila.clave, evento.target.value)}
                  disabled={!bodegaId}
                  required
                >
                  <option value="" disabled>
                    Elige la referencia
                  </option>
                  {referencias.map((referencia) => (
                    <option key={referencia.id} value={referencia.id}>
                      {referencia.producto.nombre} {referencia.presentacion}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-2">
                Lote
                <select
                  className={CLASE_DE_SELECT}
                  value={fila.loteId}
                  onChange={(evento) => cambiarFila(fila.clave, { loteId: evento.target.value })}
                  disabled={!fila.referenciaId}
                  required
                >
                  {lotes.map((lote, j) => (
                    <option key={lote.loteId} value={lote.loteId}>
                      {descripcionDeLote(lote)}
                      {j === 0 ? ' · sugerido' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-2">
                Cantidad (unidades)
                <Input
                  value={fila.cantidad}
                  inputMode="decimal"
                  onChange={(evento) => cambiarFila(fila.clave, { cantidad: evento.target.value })}
                  required
                />
              </label>
              {filas.length > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  className="self-start"
                  onClick={() =>
                    editar(() => setFilas((actuales) => actuales.filter((f) => f !== fila)))
                  }
                >
                  Quitar producto {i + 1}
                </Button>
              )}
            </fieldset>
          );
        })}

        <Button
          type="button"
          variant="outline"
          className="self-start"
          disabled={!bodegaId}
          onClick={() => editar(() => setFilas((actuales) => [...actuales, filaVacia()]))}
        >
          Agregar producto
        </Button>

        <label className="flex flex-col gap-2 font-medium">
          Quién despacha
          <Input
            value={despachador}
            onChange={(evento) => editar(() => setDespachador(evento.target.value))}
            required
          />
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="font-medium">Despacha como</legend>
          {(['funcionario', 'voluntario'] as const).map((tipo) => (
            <label key={tipo} className="flex items-center gap-2">
              <input
                type="radio"
                name="despachadorTipo"
                value={tipo}
                checked={despachadorTipo === tipo}
                onChange={() => editar(() => setDespachadorTipo(tipo))}
              />
              {tipo === 'funcionario' ? 'Funcionario' : 'Voluntario'}
            </label>
          ))}
        </fieldset>

        {aviso && <p role="alert">{aviso}</p>}
        {pendiente && (
          <p role="status" className="text-sm text-muted-foreground">
            Salida pendiente de sincronizar…
          </p>
        )}

        <Button type="submit" className="self-start" disabled={pendiente}>
          {comando ? 'Reintentar' : 'Registrar salida'}
        </Button>
      </form>
    </main>
  );
}

/** Comprobante operativo de entrega (SBA-40). No es factura ni certificado. */
function Comprobante({
  salida,
  institucion,
  lotes,
  onOtra,
}: {
  salida: Salida;
  institucion: string | undefined;
  lotes: LoteEnStock[];
  onOtra: () => void;
}) {
  const referencias = new Map(lotes.map((lote) => [lote.referencia.id, lote.referencia]));
  const valorados = salida.detalles.filter((d) => d.valorComercial !== null);
  const total = (campo: 'valorComercial' | 'aporte') =>
    valorados.reduce((suma, d) => suma + Number(d[campo] ?? 0), 0);

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Salida registrada</h1>
        <p className="text-muted-foreground">
          Comprobante operativo de entrega. No es factura ni certificado de donación.
        </p>
      </header>
      <p>
        Para {institucion ?? 'la institución'} · despachó {salida.despachador} (
        {salida.despachadorTipo})
      </p>
      <ul className="flex flex-col gap-2">
        {salida.detalles.map((detalle) => {
          const referencia = referencias.get(detalle.referenciaId);
          return (
            <li key={detalle.movimientoId} className="flex flex-col gap-1 rounded-md border p-3">
              <span className="font-medium">
                {referencia
                  ? `${referencia.producto.nombre} ${referencia.presentacion}`
                  : 'Referencia'}{' '}
                · {NUMERO.format(Number(detalle.cantidad))} unidades
              </span>
              <span>
                {detalle.valorComercial === null
                  ? 'Valor pendiente: no hay precio aprobado vigente'
                  : `Valor ${PESOS.format(Number(detalle.valorComercial))}${
                      detalle.aporte === null
                        ? ' · aporte pendiente'
                        : ` · aporte ${PESOS.format(Number(detalle.aporte))}`
                    }`}
              </span>
            </li>
          );
        })}
      </ul>
      {valorados.length > 0 && (
        <p className="font-medium">
          Total valorado {PESOS.format(total('valorComercial'))}
          {salida.aportePct !== null &&
            ` · aporte del ${salida.aportePct} %: ${PESOS.format(total('aporte'))}`}
        </p>
      )}
      <Button className="self-start" onClick={onOtra}>
        Registrar otra salida
      </Button>
    </main>
  );
}

function porVencimiento(a: LoteEnStock, b: LoteEnStock): number {
  if (a.vencimiento === b.vencimiento) return 0;
  if (a.vencimiento === null) return 1;
  if (b.vencimiento === null) return -1;
  return a.vencimiento < b.vencimiento ? -1 : 1;
}

function descripcionDeLote(lote: LoteEnStock): string {
  const codigo = lote.codigo ? `Lote ${lote.codigo}` : 'Lote sin código';
  const vence = lote.vencimiento ? `vence ${fecha(lote.vencimiento)}` : 'sin fecha';
  return `${codigo} · ${vence} · hay ${NUMERO.format(Number(lote.cantidad))}`;
}

/** AAAA-MM-DD a DD/MM/AAAA sin pasar por Date, que lo correría de día según la zona. */
function fecha(vencimiento: string): string {
  const [anio, mes, dia] = vencimiento.split('-');
  return `${dia}/${mes}/${anio}`;
}

/** Mientras SBA-34 no exponga el nombre de las bodegas, el comienzo del id. */
function nombreDeBodega(id: string): string {
  return `Bodega ${id.slice(0, 8)}`;
}

function motivo(error: unknown): string {
  if (error instanceof ErrorDeApi) return error.message;
  return 'Sin señal. La salida no se registró; reintenta cuando vuelva la señal.';
}
