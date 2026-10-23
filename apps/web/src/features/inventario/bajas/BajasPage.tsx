import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { cn } from 'cn';
import { uuidv7 } from '@/offline/uuidv7.ts';
import { interpretarCantidad } from '@/shared/cantidad.ts';
import { ErrorDeApi } from '@/shared/clienteHttp.ts';
import type { LoteEnStock } from '@/shared/stock.ts';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { CantidadLeida } from '../CantidadLeida.tsx';
import { useBodegasActivas } from '../useBodegas.ts';
import { STOCK_QUERY_KEY, useStock } from '../useStock.ts';
import {
  type ComandoSobreUnLote,
  MOTIVOS_DE_BAJA,
  type MotivoDeBaja,
  type MovimientoRegistrado,
  type TipoDeMovimiento,
  useRegistrarMovimiento,
} from './registrarMovimiento.ts';

const NOMBRE_DE_MOTIVO: Record<MotivoDeBaja, string> = {
  vencido: 'Vencido',
  no_apto: 'No apto',
  roto: 'Roto',
  perdida: 'Pérdida',
};

/** Suficientes para elegir con el pulgar sin desplazarse. */
const MAXIMO_DE_LOTES = 8;

const NUMERO = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 });

/** El comando enviado sin respuesta y la carga con que se armó, sin los ids. */
interface Pendiente {
  carga: string;
  comando: ComandoSobreUnLote;
}

/**
 * Bajas por producto no apto y ajustes de inventario con motivo (SBA-81,
 * RF-M1-13). El saldo no se edita: se corrige con un movimiento. El comando
 * se conserva entre reintentos y cambia solo si cambia la carga que se
 * registra: tocar un campo y dejarlo como estaba no cuenta.
 */
export function BajasPage() {
  const stock = useStock();
  const bodegas = useBodegasActivas();
  const registrar = useRegistrarMovimiento();
  const consultas = useQueryClient();

  const [tipo, setTipo] = useState<TipoDeMovimiento>('baja');
  const [texto, setTexto] = useState('');
  /** Bodega y lote elegidos; el saldo se lee del stock vigente, que se recarga tras un 409. */
  const [elegido, setElegido] = useState<string | null>(null);
  const [cantidad, setCantidad] = useState('');
  const [motivoDeBaja, setMotivoDeBaja] = useState<MotivoDeBaja | null>(null);
  const [sentido, setSentido] = useState<'sobra' | 'falta'>('falta');
  const [motivoDeAjuste, setMotivoDeAjuste] = useState('');
  /** El último comando enviado sin respuesta; se reenvía igual si la carga no cambió. */
  const [pendiente, setPendiente] = useState<Pendiente | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  /** Lo que respondió la API y el lote que se envió, no el que haya ahora en pantalla. */
  const [exito, setExito] = useState<{
    registrado: MovimientoRegistrado;
    lote: LoteEnStock;
  } | null>(null);

  function cambio<T>(asignar: (valor: T) => void) {
    return (valor: T) => {
      asignar(valor);
      setAviso(null);
    };
  }

  const nombreDeBodega = (id: string) =>
    bodegas.data?.find((bodega) => bodega.id === id)?.nombre ?? 'Bodega';

  const lote = stock.data?.lotes.find((l) => claveDe(l) === elegido) ?? null;
  const setLote = (l: LoteEnStock | null) => setElegido(l && claveDe(l));

  const buscado = normalizar(texto);
  const lotes = buscado
    ? (stock.data?.lotes ?? [])
        .filter((l) =>
          normalizar(
            `${l.referencia.producto.nombre} ${l.referencia.presentacion} ${l.codigo ?? ''}`,
          ).includes(buscado),
        )
        .slice(0, MAXIMO_DE_LOTES)
    : [];

  const faltante = queFalta(tipo, lote, cantidad, motivoDeBaja, motivoDeAjuste);
  const datos =
    !faltante && lote
      ? datosDe(
          lote,
          interpretarCantidad(cantidad).valor ?? '',
          tipo,
          sentido,
          motivoDeBaja,
          motivoDeAjuste,
        )
      : null;
  const carga = datos && JSON.stringify({ tipo, ...datos });
  const esReintento = pendiente !== null && pendiente.carga === carga;

  async function registrarMovimiento() {
    if (faltante || !lote || !datos || !carga) return setAviso(faltante);
    const aEnviar = esReintento
      ? pendiente.comando
      : { comandoId: uuidv7(), movimientoId: uuidv7(), ...datos };
    setPendiente({ carga, comando: aEnviar });
    setEnviando(true);
    setAviso(null);
    try {
      setExito({ registrado: await registrar(tipo, aEnviar), lote });
      setPendiente(null);
      void consultas.invalidateQueries({ queryKey: STOCK_QUERY_KEY });
    } catch (error) {
      // Un saldo insuficiente suele ser un stock en pantalla que ya no es el real.
      if (error instanceof ErrorDeApi && error.estado === 409) {
        void consultas.invalidateQueries({ queryKey: STOCK_QUERY_KEY });
      }
      setAviso(motivo(error));
    } finally {
      setEnviando(false);
    }
  }

  function otro() {
    setLote(null);
    setTexto('');
    setCantidad('');
    setMotivoDeBaja(null);
    setMotivoDeAjuste('');
    setExito(null);
  }

  if (exito) {
    const { registrado, lote: enviado } = exito;
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-5 p-4 sm:p-6">
        <div role="status">
          <h1 className="text-2xl font-semibold tracking-tight">
            {registrado.tipo === 'baja' ? 'Baja registrada' : 'Ajuste registrado'}
          </h1>
        </div>
        <p className="text-lg">
          {enviado.referencia.producto.nombre} {enviado.referencia.presentacion} ·{' '}
          {enviado.codigo ? `Lote ${enviado.codigo}` : 'Lote sin código'} ·{' '}
          {NUMERO.format(Number(registrado.cantidad))} unidades (
          {NUMERO.format(Number(registrado.kilos))} kg)
        </p>
        <Button size="lg" className="h-14 text-lg" onClick={otro}>
          Registrar otro movimiento
        </Button>
      </div>
    );
  }

  return (
    // Un fieldset deshabilitado bloquea todos los campos y botones de adentro.
    <fieldset
      disabled={enviando}
      className="mx-auto flex max-w-xl min-w-0 flex-col gap-6 border-0 p-4 sm:p-6"
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Bajas y ajustes</h1>
        <p className="text-muted-foreground">El saldo no se edita: se corrige con un movimiento.</p>
      </header>

      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Tipo de movimiento">
        {(['baja', 'ajuste'] as const).map((opcion) => (
          <Button
            key={opcion}
            variant="outline"
            size="lg"
            aria-pressed={tipo === opcion}
            className={cn('h-14 text-lg', tipo === opcion && 'border-primary bg-primary/10')}
            onClick={() => cambio(setTipo)(opcion)}
          >
            {opcion === 'baja' ? 'Baja' : 'Ajuste'}
          </Button>
        ))}
      </div>

      <section className="flex flex-col gap-2" aria-labelledby="titulo-lote">
        <h2 id="titulo-lote" className="text-lg font-semibold">
          Lote
        </h2>
        {stock.data?.desactualizado && (
          <p role="status" className="text-sm text-muted-foreground">
            Stock posiblemente desactualizado.
          </p>
        )}
        {stock.isError && !stock.data && <p role="alert">No se pudo consultar el stock.</p>}
        {lote ? (
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <DescripcionDeLote lote={lote} bodega={nombreDeBodega(lote.bodegaId)} />
            <Button variant="outline" size="lg" onClick={() => cambio(setLote)(null)}>
              Cambiar
            </Button>
          </div>
        ) : (
          <>
            <Input
              aria-label="Buscar lote"
              placeholder="Producto, presentación o lote"
              className="h-12 text-base"
              value={texto}
              onChange={(evento) => setTexto(evento.target.value)}
            />
            {buscado && stock.data && lotes.length === 0 && <p>No hay lotes con saldo así.</p>}
            {lotes.map((l) => (
              <Button
                key={claveDe(l)}
                variant="outline"
                className="h-auto min-h-12 justify-start py-3 text-left text-base whitespace-normal"
                onClick={() => cambio(setLote)(l)}
              >
                <DescripcionDeLote lote={l} bodega={nombreDeBodega(l.bodegaId)} />
              </Button>
            ))}
          </>
        )}
      </section>

      {tipo === 'ajuste' && (
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="El conteo encontró">
          {(['falta', 'sobra'] as const).map((opcion) => (
            <Button
              key={opcion}
              variant="outline"
              size="lg"
              aria-pressed={sentido === opcion}
              className={cn(sentido === opcion && 'border-primary bg-primary/10')}
              onClick={() => cambio(setSentido)(opcion)}
            >
              {opcion === 'falta' ? 'Falta producto' : 'Sobra producto'}
            </Button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-2 text-lg font-semibold">
          {tipo === 'baja' ? 'Unidades que salen' : 'Unidades de diferencia'}
          <Input
            inputMode="decimal"
            placeholder="Ej. 3"
            className="h-12 text-base"
            value={cantidad}
            onChange={(evento) => cambio(setCantidad)(evento.target.value)}
          />
        </label>
        <CantidadLeida texto={cantidad} />
      </div>

      {tipo === 'baja' ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-lg font-semibold">Motivo</legend>
          <div className="grid grid-cols-2 gap-2">
            {MOTIVOS_DE_BAJA.map((opcion) => (
              <Button
                key={opcion}
                variant="outline"
                size="lg"
                aria-pressed={motivoDeBaja === opcion}
                className={cn(motivoDeBaja === opcion && 'border-primary bg-primary/10')}
                onClick={() => cambio(setMotivoDeBaja)(opcion)}
              >
                {NOMBRE_DE_MOTIVO[opcion]}
              </Button>
            ))}
          </div>
        </fieldset>
      ) : (
        <label className="flex flex-col gap-2 text-lg font-semibold">
          Motivo
          <Input
            placeholder="Ej. Conteo de fin de mes"
            className="h-12 text-base"
            value={motivoDeAjuste}
            onChange={(evento) => cambio(setMotivoDeAjuste)(evento.target.value)}
          />
        </label>
      )}

      {aviso && <p role="alert">{aviso}</p>}

      <Button size="lg" className="h-14 text-lg" disabled={enviando} onClick={registrarMovimiento}>
        {enviando
          ? 'Enviando…'
          : esReintento
            ? 'Reintentar'
            : tipo === 'baja'
              ? 'Registrar baja'
              : 'Registrar ajuste'}
      </Button>
    </fieldset>
  );
}

function DescripcionDeLote({ lote, bodega }: { lote: LoteEnStock; bodega: string }) {
  return (
    <span className="flex flex-col">
      <span className="font-medium">
        {lote.referencia.producto.nombre} {lote.referencia.presentacion}
      </span>
      <span className="text-sm text-muted-foreground">
        {lote.codigo ? `Lote ${lote.codigo}` : 'Lote sin código'} · {bodega} · Saldo{' '}
        {NUMERO.format(Number(lote.cantidad))}
        {lote.vencimiento ? ` · Vence ${fecha(lote.vencimiento)}` : ''}
      </span>
    </span>
  );
}

function queFalta(
  tipo: TipoDeMovimiento,
  lote: LoteEnStock | null,
  cantidad: string,
  motivoDeBaja: MotivoDeBaja | null,
  motivoDeAjuste: string,
): string | null {
  if (!lote) return 'Elige el lote.';
  const { valor, error } = interpretarCantidad(cantidad);
  if (error) return 'Revisa la cantidad.';
  if (!(Number(valor) > 0)) return 'Escribe una cantidad mayor que cero.';
  if (tipo === 'baja' && !motivoDeBaja) return 'Elige el motivo de la baja.';
  if (tipo === 'ajuste' && !motivoDeAjuste.trim()) return 'Escribe el motivo del ajuste.';
  return null;
}

function claveDe(lote: LoteEnStock): string {
  return `${lote.bodegaId}/${lote.loteId}`;
}

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

/** Lo que se registra, sin los ids que genera el celular. En el ajuste, la cantidad lleva el signo. */
function datosDe(
  lote: LoteEnStock,
  cantidad: string,
  tipo: TipoDeMovimiento,
  sentido: 'sobra' | 'falta',
  motivoDeBaja: MotivoDeBaja | null,
  motivoDeAjuste: string,
): Omit<ComandoSobreUnLote, 'comandoId' | 'movimientoId'> {
  return {
    bodegaId: lote.bodegaId,
    referenciaId: lote.referencia.id,
    loteId: lote.loteId,
    cantidad: tipo === 'ajuste' && sentido === 'falta' ? `-${cantidad}` : cantidad,
    motivo: tipo === 'baja' ? (motivoDeBaja ?? '') : motivoDeAjuste.trim(),
  };
}

/** AAAA-MM-DD a DD/MM/AAAA sin pasar por Date, que lo correría de día según la zona. */
function fecha(vencimiento: string): string {
  const [anio, mes, dia] = vencimiento.split('-');
  return `${dia}/${mes}/${anio}`;
}

function motivo(error: unknown): string {
  if (error instanceof ErrorDeApi) {
    if (error.estado === 403) return 'Tu rol no puede registrar bajas ni ajustes.';
    // 400, 404 y 409 traen el motivo en español: saldo insuficiente, lote que no existe.
    if ([400, 404, 409].includes(error.estado)) return error.message;
    return 'No se pudo registrar. Inténtalo de nuevo.';
  }
  return 'Sin señal · no se registró todavía. Reintenta: se envía el mismo registro.';
}
