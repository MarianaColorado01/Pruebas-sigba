import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { cn } from 'cn';
import { uuidv7 } from '@/offline/uuidv7.ts';
import { ErrorDeApi } from '@/shared/clienteHttp.ts';
import type { LoteEnStock } from '@/shared/stock.ts';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
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

/**
 * Bajas por producto no apto y ajustes de inventario con motivo (SBA-81,
 * RF-M1-13). El saldo no se edita: se corrige con un movimiento. El comando
 * se conserva entre reintentos y cambia solo si cambia lo que se registra.
 */
export function BajasPage() {
  const stock = useStock();
  const bodegas = useBodegasActivas();
  const registrar = useRegistrarMovimiento();
  const consultas = useQueryClient();

  const [tipo, setTipo] = useState<TipoDeMovimiento>('baja');
  const [texto, setTexto] = useState('');
  const [lote, setLote] = useState<LoteEnStock | null>(null);
  const [cantidad, setCantidad] = useState('');
  const [motivoDeBaja, setMotivoDeBaja] = useState<MotivoDeBaja | null>(null);
  const [sentido, setSentido] = useState<'sobra' | 'falta'>('falta');
  const [motivoDeAjuste, setMotivoDeAjuste] = useState('');
  const [comando, setComando] = useState<ComandoSobreUnLote | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [registrado, setRegistrado] = useState<MovimientoRegistrado | null>(null);

  function cambio<T>(asignar: (valor: T) => void) {
    return (valor: T) => {
      asignar(valor);
      setComando(null);
      setAviso(null);
    };
  }

  const nombreDeBodega = (id: string) =>
    bodegas.data?.find((bodega) => bodega.id === id)?.nombre ?? 'Bodega';

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

  async function registrarMovimiento() {
    if (faltante || !lote) return setAviso(faltante);
    const aEnviar = comando ?? {
      comandoId: uuidv7(),
      movimientoId: uuidv7(),
      bodegaId: lote.bodegaId,
      referenciaId: lote.referencia.id,
      loteId: lote.loteId,
      cantidad:
        tipo === 'ajuste' && sentido === 'falta' ? `-${decimal(cantidad)}` : decimal(cantidad),
      motivo: tipo === 'baja' ? (motivoDeBaja ?? '') : motivoDeAjuste.trim(),
    };
    setComando(aEnviar);
    setEnviando(true);
    setAviso(null);
    try {
      setRegistrado(await registrar(tipo, aEnviar));
      setComando(null);
      void consultas.invalidateQueries({ queryKey: STOCK_QUERY_KEY });
    } catch (error) {
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
    setRegistrado(null);
  }

  if (registrado && lote) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-5 p-4 sm:p-6">
        <div role="status">
          <h1 className="text-2xl font-semibold tracking-tight">
            {registrado.tipo === 'baja' ? 'Baja registrada' : 'Ajuste registrado'}
          </h1>
        </div>
        <p className="text-lg">
          {lote.referencia.producto.nombre} {lote.referencia.presentacion} ·{' '}
          {lote.codigo ? `Lote ${lote.codigo}` : 'Lote sin código'} ·{' '}
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
    <div className="mx-auto flex max-w-xl flex-col gap-6 p-4 sm:p-6">
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
                key={`${l.bodegaId}/${l.loteId}`}
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
          : comando
            ? 'Reintentar'
            : tipo === 'baja'
              ? 'Registrar baja'
              : 'Registrar ajuste'}
      </Button>
    </div>
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
  if (!(Number(decimal(cantidad)) > 0)) return 'Escribe una cantidad mayor que cero.';
  if (tipo === 'baja' && !motivoDeBaja) return 'Elige el motivo de la baja.';
  if (tipo === 'ajuste' && !motivoDeAjuste.trim()) return 'Escribe el motivo del ajuste.';
  return null;
}

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
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
    if (error.estado === 403) return 'Tu rol no puede registrar bajas ni ajustes.';
    // 400, 404 y 409 traen el motivo en español: saldo insuficiente, lote que no existe.
    if ([400, 404, 409].includes(error.estado)) return error.message;
    return 'No se pudo registrar. Inténtalo de nuevo.';
  }
  return 'Sin señal · no se registró todavía. Reintenta: se envía el mismo registro.';
}
