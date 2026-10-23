import { useState } from 'react';
import type { Catalogo, ReferenciaDelCatalogo } from '@/shared/catalogo.ts';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { CantidadLeida } from '../CantidadLeida.tsx';
import { CrearPresentacion } from '../CrearPresentacion.tsx';
import { buscarEnCatalogo } from '../useCatalogo.ts';
import { NOVEDADES, type Novedad } from './enviarRecepcion.ts';
import { NOMBRE_DE_NOVEDAD } from './nombres.ts';

export interface Fila {
  /** Solo para React; el `movimientoId` se genera al enviar. */
  clave: string;
  referencia: ReferenciaDelCatalogo | null;
  cantidad: string;
  lote: string;
  vencimiento: string;
  novedad: Novedad | '';
}

/** Suficientes para elegir con el pulgar sin desplazarse. */
const MAXIMO_DE_SUGERENCIAS = 6;

const CLASE_DE_SELECT =
  'h-12 w-full rounded-md border border-input bg-input/20 px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30';

interface Props {
  numero: number;
  fila: Fila;
  catalogo: Catalogo | undefined;
  onCambio: (cambios: Partial<Fila>) => void;
  onQuitar?: () => void;
}

/**
 * Una referencia recibida con su cantidad, lote y vencimiento. La referencia
 * se busca en la copia local del catálogo; si no está, se crea la
 * presentación aquí mismo (SBA-23).
 */
export function FilaDeRecepcion({ numero, fila, catalogo, onCambio, onQuitar }: Props) {
  const [texto, setTexto] = useState('');
  const [creando, setCreando] = useState(false);
  const titulo = `Referencia ${numero}`;

  const sugerencias =
    catalogo && texto.trim()
      ? buscarEnCatalogo(catalogo, texto).slice(0, MAXIMO_DE_SUGERENCIAS)
      : [];

  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border p-4">
      <legend className="flex w-full items-center justify-between px-1 text-lg font-semibold">
        {titulo}
      </legend>

      {fila.referencia ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-lg font-medium">
            {fila.referencia.producto.nombre} {fila.referencia.presentacion}
          </span>
          <Button
            variant="outline"
            size="lg"
            aria-label={`Cambiar ${titulo.toLowerCase()}`}
            onClick={() => onCambio({ referencia: null })}
          >
            Cambiar
          </Button>
        </div>
      ) : creando ? (
        <>
          <CrearPresentacion
            productos={catalogo?.categorias.flatMap((categoria) => categoria.productos) ?? []}
            onLista={(referencia) => {
              onCambio({ referencia });
              setCreando(false);
            }}
          />
          <Button variant="ghost" size="lg" onClick={() => setCreando(false)}>
            Volver a buscar
          </Button>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <Input
            aria-label={`Buscar ${titulo.toLowerCase()}`}
            placeholder="Producto o presentación"
            className="h-12 text-base"
            value={texto}
            onChange={(evento) => setTexto(evento.target.value)}
          />
          {sugerencias.map((referencia) => (
            <Button
              key={referencia.id}
              variant="outline"
              className="h-auto min-h-12 justify-start py-3 text-left text-base whitespace-normal"
              onClick={() => {
                onCambio({ referencia });
                setTexto('');
              }}
            >
              {referencia.producto.nombre} {referencia.presentacion}
            </Button>
          ))}
          {texto.trim() && (
            <Button variant="ghost" size="lg" onClick={() => setCreando(true)}>
              No la encuentro: crear presentación
            </Button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-2 font-medium">
            Cantidad
            <Input
              inputMode="decimal"
              placeholder="Ej. 12"
              className="h-12 text-base"
              value={fila.cantidad}
              onChange={(evento) => onCambio({ cantidad: evento.target.value })}
            />
          </label>
          <CantidadLeida texto={fila.cantidad} />
        </div>
        <label className="flex flex-col gap-2 font-medium">
          Lote
          <Input
            placeholder="Si lo trae"
            className="h-12 text-base"
            value={fila.lote}
            onChange={(evento) => onCambio({ lote: evento.target.value })}
          />
        </label>
        <label className="flex flex-col gap-2 font-medium">
          Vence
          <Input
            type="date"
            className="h-12 text-base"
            value={fila.vencimiento}
            onChange={(evento) => onCambio({ vencimiento: evento.target.value })}
          />
        </label>
        <label className="flex flex-col gap-2 font-medium">
          Novedad
          <select
            className={CLASE_DE_SELECT}
            value={fila.novedad}
            onChange={(evento) => onCambio({ novedad: evento.target.value as Novedad | '' })}
          >
            <option value="">Ninguna</option>
            {NOVEDADES.map((novedad) => (
              <option key={novedad} value={novedad}>
                {NOMBRE_DE_NOVEDAD[novedad]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-sm text-muted-foreground">Sin fecha en el empaque, deja «Vence» vacío.</p>

      {onQuitar && (
        <Button variant="destructive" size="lg" onClick={onQuitar}>
          Quitar {titulo.toLowerCase()}
        </Button>
      )}
    </fieldset>
  );
}
