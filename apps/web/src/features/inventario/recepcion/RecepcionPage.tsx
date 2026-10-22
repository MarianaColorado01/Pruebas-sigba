import { useState } from 'react';
import { cn } from 'cn';
import { uuidv7 } from '@/offline/uuidv7.ts';
import type { ReferenciaDelCatalogo } from '@/shared/catalogo.ts';
import { ErrorDeApi } from '@/shared/clienteHttp.ts';
import { Button } from '@/ui/button';
import { useCatalogo } from '../useCatalogo.ts';
import { useBodegasActivas } from '../useBodegas.ts';
import type { Donante } from './datos.ts';
import { ElegirDonante } from './ElegirDonante.tsx';
import {
  type ComandoDeRecepcion,
  ORIGENES,
  type Origen,
  type RecepcionConfirmada,
  type ResultadoDeRecepcion,
  useEnviarRecepcion,
} from './enviarRecepcion.ts';
import { type Fila, FilaDeRecepcion } from './FilaDeRecepcion.tsx';
import { NOMBRE_DE_NOVEDAD, NOMBRE_DE_ORIGEN } from './nombres.ts';

const CLASE_DE_SELECT =
  'h-12 w-full rounded-md border border-input bg-input/20 px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30';

function filaVacia(): Fila {
  return {
    clave: crypto.randomUUID(),
    referencia: null,
    cantidad: '',
    lote: '',
    vencimiento: '',
    novedad: '',
  };
}

/**
 * Recepción de una donación con red (SBA-80, RF-M1-01). El comando lleva un
 * `comandoId` del celular que se conserva entre reintentos y cambia solo si
 * cambia lo que se va a registrar: así un reenvío tras perder la señal no
 * duplica inventario.
 */
export function RecepcionPage() {
  const catalogo = useCatalogo();
  const bodegas = useBodegasActivas();
  const enviar = useEnviarRecepcion();

  const [bodegaId, setBodegaId] = useState('');
  const [origen, setOrigen] = useState<Origen | null>(null);
  const [donante, setDonante] = useState<Donante | null>(null);
  const [filas, setFilas] = useState<Fila[]>(() => [filaVacia()]);
  /** El último comando enviado sin respuesta; se reenvía igual. */
  const [comando, setComando] = useState<ComandoDeRecepcion | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoDeRecepcion | null>(null);

  /** Cualquier cambio invalida el comando pendiente: lo que se enviará ya es otro. */
  function cambio<T>(asignar: (valor: T) => void) {
    return (valor: T) => {
      asignar(valor);
      setComando(null);
      setAviso(null);
    };
  }

  const cambiarFila = (clave: string) =>
    cambio((cambios: Partial<Fila>) =>
      setFilas((actuales) => actuales.map((f) => (f.clave === clave ? { ...f, ...cambios } : f))),
    );

  const faltante = queFalta(bodegaId, origen, donante, filas);

  async function confirmar() {
    if (faltante || !origen || !donante) return setAviso(faltante);
    const aEnviar = comando ?? armarComando(bodegaId, origen, donante, filas);
    setComando(aEnviar);
    setEnviando(true);
    setAviso(null);
    try {
      setResultado(await enviar(aEnviar));
      setComando(null);
    } catch (error) {
      setAviso(motivo(error));
    } finally {
      setEnviando(false);
    }
  }

  function otra() {
    setDonante(null);
    setFilas([filaVacia()]);
    setResultado(null);
  }

  if (resultado) {
    return (
      <Resultado
        resultado={resultado}
        referencias={filas.flatMap((f) => (f.referencia ? [f.referencia] : []))}
        onOtra={otra}
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Recepción</h1>
        <p className="text-muted-foreground">Lo que llegó, de quién y a qué bodega.</p>
      </header>

      <label className="flex flex-col gap-2 text-lg font-semibold">
        Bodega
        <select
          className={CLASE_DE_SELECT}
          value={bodegaId}
          onChange={(evento) => cambio(setBodegaId)(evento.target.value)}
        >
          <option value="" disabled>
            {bodegas.isPending ? 'Cargando bodegas…' : 'Elige la bodega'}
          </option>
          {bodegas.data?.map((bodega) => (
            <option key={bodega.id} value={bodega.id}>
              {bodega.nombre}
            </option>
          ))}
        </select>
      </label>
      {bodegas.isError && <p role="alert">No se pudieron cargar las bodegas.</p>}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-lg font-semibold">Origen</legend>
        <div className="grid grid-cols-3 gap-2">
          {ORIGENES.map((opcion) => (
            <Button
              key={opcion}
              variant="outline"
              size="lg"
              aria-pressed={origen === opcion}
              className={cn(origen === opcion && 'border-primary bg-primary/10')}
              onClick={() => cambio(setOrigen)(opcion)}
            >
              {NOMBRE_DE_ORIGEN[opcion]}
            </Button>
          ))}
        </div>
      </fieldset>

      <section className="flex flex-col gap-2" aria-labelledby="titulo-donante">
        <h2 id="titulo-donante" className="text-lg font-semibold">
          Donante
        </h2>
        <ElegirDonante donante={donante} onCambio={cambio(setDonante)} />
      </section>

      {catalogo.data?.desactualizado && (
        <p role="status" className="text-sm text-muted-foreground">
          Catálogo posiblemente desactualizado.
        </p>
      )}

      {filas.map((fila, indice) => (
        <FilaDeRecepcion
          key={fila.clave}
          numero={indice + 1}
          fila={fila}
          catalogo={catalogo.data?.catalogo}
          onCambio={cambiarFila(fila.clave)}
          {...(filas.length > 1 && {
            onQuitar: () =>
              cambio(setFilas)(filas.filter((otraFila) => otraFila.clave !== fila.clave)),
          })}
        />
      ))}

      <Button variant="outline" size="lg" onClick={() => cambio(setFilas)([...filas, filaVacia()])}>
        Agregar otra referencia
      </Button>

      {aviso && <p role="alert">{aviso}</p>}

      <Button size="lg" className="h-14 text-lg" disabled={enviando} onClick={confirmar}>
        {enviando ? 'Enviando…' : comando ? 'Reintentar' : 'Confirmar recepción'}
      </Button>
    </div>
  );
}

function Resultado({
  resultado,
  referencias,
  onOtra,
}: {
  resultado: ResultadoDeRecepcion;
  referencias: ReferenciaDelCatalogo[];
  onOtra: () => void;
}) {
  const nombre = (id: string) => {
    const referencia = referencias.find((r) => r.id === id);
    return referencia ? `${referencia.producto.nombre} ${referencia.presentacion}` : 'Referencia';
  };

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5 p-4 sm:p-6">
      {resultado.estado === 'pendiente' ? (
        <p role="status" className="text-xl font-semibold">
          Guardada en el celular · pendiente de sincronizar
        </p>
      ) : (
        <Confirmada recepcion={resultado.recepcion} nombre={nombre} />
      )}
      <Button size="lg" className="h-14 text-lg" onClick={onOtra}>
        Registrar otra recepción
      </Button>
    </div>
  );
}

function Confirmada({
  recepcion,
  nombre,
}: {
  recepcion: RecepcionConfirmada;
  nombre: (referenciaId: string) => string;
}) {
  const pendientes = recepcion.detalles.filter((d) => d.valoracion === 'pendiente').length;

  return (
    <>
      <div role="status">
        <h1 className="text-2xl font-semibold tracking-tight">Recepción confirmada</h1>
      </div>
      {pendientes > 0 && (
        <p>
          {pendientes === 1
            ? '1 referencia quedó con valoración pendiente'
            : `${pendientes} referencias quedaron con valoración pendiente`}
          : no hay precio vigente aprobado. Coordinación la valora después; el inventario ya entró.
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {recepcion.detalles.map((detalle) => (
          <li key={detalle.movimientoId} className="flex flex-col gap-1 rounded-md border p-3">
            <span className="font-medium">{nombre(detalle.referenciaId)}</span>
            <span>
              {detalle.cantidad} · {detalle.kilos} kg
              {detalle.lote ? ` · Lote ${detalle.lote}` : ''}
              {detalle.vencimiento ? ` · Vence ${fecha(detalle.vencimiento)}` : ''}
              {detalle.novedad ? ` · ${NOMBRE_DE_NOVEDAD[detalle.novedad]}` : ''}
            </span>
            {detalle.valoracion === 'pendiente' && (
              <span className="w-fit rounded-sm bg-amber-100 px-2 py-0.5 text-sm font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                Valoración pendiente
              </span>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function queFalta(
  bodegaId: string,
  origen: Origen | null,
  donante: Donante | null,
  filas: Fila[],
): string | null {
  if (!bodegaId) return 'Elige la bodega.';
  if (!origen) return 'Elige el origen.';
  if (!donante) return 'Elige o crea el donante.';
  const sinReferencia = filas.findIndex((f) => !f.referencia);
  if (sinReferencia >= 0) return `Elige la referencia ${sinReferencia + 1}.`;
  const sinCantidad = filas.findIndex((f) => !(Number(decimal(f.cantidad)) > 0));
  if (sinCantidad >= 0)
    return `Escribe una cantidad mayor que cero en la referencia ${sinCantidad + 1}.`;
  return null;
}

function armarComando(
  bodegaId: string,
  origen: Origen,
  donante: Donante,
  filas: Fila[],
): ComandoDeRecepcion {
  return {
    comandoId: uuidv7(),
    donanteId: donante.id,
    origen,
    bodegaId,
    detalles: filas.map((fila) => ({
      movimientoId: uuidv7(),
      referenciaId: fila.referencia?.id ?? '',
      cantidad: decimal(fila.cantidad),
      lote: fila.lote.trim() || null,
      vencimiento: fila.vencimiento || null,
      novedad: fila.novedad || null,
    })),
  };
}

/** La coma del teclado colombiano pasa a punto, que es lo que lee la API. */
function decimal(texto: string): string {
  return texto.trim().replace(',', '.');
}

/** AAAA-MM-DD a DD/MM/AAAA sin pasar por Date, que lo correría de día según la zona. */
function fecha(vencimiento: string): string {
  const [anio, mes, dia] = vencimiento.split('-');
  return `${dia}/${mes}/${anio}`;
}

function motivo(error: unknown): string {
  if (error instanceof ErrorDeApi) {
    if (error.estado === 409) {
      return 'La API ya tiene este registro con otros datos. Revisa el stock antes de registrarlo otra vez.';
    }
    if (error.estado === 403) return 'Tu rol no puede registrar recepciones.';
    if (error.estado === 400 || error.estado === 404) return error.message;
    return 'No se pudo registrar. Inténtalo de nuevo.';
  }
  return 'Sin señal · no se registró todavía. Reintenta: se envía el mismo registro.';
}
