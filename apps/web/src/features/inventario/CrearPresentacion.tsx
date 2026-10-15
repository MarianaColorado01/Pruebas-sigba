import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { uuidv7 } from '@/offline/uuidv7.ts';
import type { ReferenciaDelCatalogo } from '@/shared/catalogo.ts';
import { ErrorDeApi } from '@/shared/clienteHttp.ts';
import { usePedir } from '@/shared/sesion.ts';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';

interface Props {
  productos: { id: string; nombre: string }[];
  /** La presentación que el operario va a usar: una sugerida o la recién creada. */
  onLista: (referencia: ReferenciaDelCatalogo) => void;
}

/**
 * Alta de una presentación que no está en el catálogo, sin salir del registro
 * (SBA-23). Antes de crear muestra las del producto que podrían ser la misma
 * con otro nombre. Mientras la API no responde, la presentación dice
 * «pendiente de sincronizar» (ADR-10); si falla la señal, reintentar manda el
 * mismo comando y la API no la duplica.
 */
export function CrearPresentacion({ productos, onLista }: Props) {
  const pedir = usePedir();
  const cliente = useQueryClient();
  const [productoId, setProductoId] = useState('');
  const [presentacion, setPresentacion] = useState('');
  const [kilos, setKilos] = useState('');
  const [similares, setSimilares] = useState<ReferenciaDelCatalogo[] | null>(null);
  /** Se conserva entre reintentos; cambia solo si cambia lo que se va a crear. */
  const [comandoId, setComandoId] = useState<string | null>(null);
  const [pendiente, setPendiente] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  function cambiar(asignar: (valor: string) => void) {
    return (valor: string) => {
      asignar(valor);
      setSimilares(null);
      setComandoId(null);
      setAviso(null);
    };
  }

  async function revisar(evento: FormEvent) {
    evento.preventDefault();
    // Ya revisadas o es un reintento: lo que falta es crear.
    if (similares || comandoId) return crear();
    const consulta = new URLSearchParams({ presentacion, equivalenciaKg: kilos });
    try {
      const encontradas = await pedir<ReferenciaDelCatalogo[]>(
        `/productos/${productoId}/presentaciones-similares?${consulta}`,
      );
      if (encontradas.length > 0) setSimilares(encontradas);
      else await crear();
    } catch (error) {
      setAviso(motivo(error));
    }
  }

  async function crear() {
    const id = comandoId ?? uuidv7();
    setComandoId(id);
    setPendiente(true);
    setAviso(null);
    try {
      const referencia = await pedir<ReferenciaDelCatalogo>('/referencias/desde-celular', {
        method: 'POST',
        body: JSON.stringify({ comandoId: id, productoId, presentacion, equivalenciaKg: kilos }),
      });
      await cliente.invalidateQueries({ queryKey: ['inventario'] });
      onLista(referencia);
      setPresentacion('');
      setKilos('');
      setSimilares(null);
      setComandoId(null);
    } catch (error) {
      setAviso(motivo(error));
    } finally {
      setPendiente(false);
    }
  }

  const producto = productos.find((p) => p.id === productoId);

  return (
    <form onSubmit={revisar} className="flex flex-col gap-3 rounded-lg border p-4">
      <h2 className="text-lg font-semibold">Crear presentación</h2>

      <label className="flex flex-col gap-2 font-medium">
        Producto
        <select
          className="h-11 rounded-md border border-input bg-input/20 px-3 text-base"
          value={productoId}
          onChange={(evento) => cambiar(setProductoId)(evento.target.value)}
          required
        >
          <option value="" disabled>
            Elige el producto
          </option>
          {productos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-2 font-medium">
        Presentación
        <Input
          value={presentacion}
          placeholder="Ej. 480 g promocional"
          onChange={(evento) => cambiar(setPresentacion)(evento.target.value)}
          required
        />
      </label>

      <label className="flex flex-col gap-2 font-medium">
        Equivale a (kg)
        <Input
          value={kilos}
          inputMode="decimal"
          placeholder="Ej. 0,48"
          onChange={(evento) => cambiar(setKilos)(evento.target.value)}
          required
        />
      </label>

      {similares && (
        <div className="flex flex-col gap-2">
          <p className="font-medium">¿Es alguna de estas?</p>
          {similares.map((referencia) => (
            <Button
              key={referencia.id}
              type="button"
              variant="outline"
              className="h-auto min-h-12 justify-start whitespace-normal py-3 text-left"
              onClick={() => onLista(referencia)}
            >
              {referencia.producto.nombre} {referencia.presentacion} · {referencia.equivalenciaKg}{' '}
              kg
            </Button>
          ))}
        </div>
      )}

      {pendiente && (
        <p role="status">
          {producto?.nombre} {presentacion} · pendiente de sincronizar
        </p>
      )}
      {aviso && <p role="alert">{aviso}</p>}

      <Button type="submit" className="min-h-12" disabled={pendiente}>
        {similares ? 'No es ninguna: crear' : comandoId ? 'Reintentar' : 'Crear presentación'}
      </Button>
    </form>
  );
}

function motivo(error: unknown): string {
  if (error instanceof ErrorDeApi) {
    if (error.estado === 409) return 'Ese producto ya tiene esa presentación.';
    if (error.estado === 400) return 'Revisa la presentación y los kilos.';
    if (error.estado === 404) return 'Ese producto ya no está en el catálogo.';
    return 'No se pudo crear. Inténtalo de nuevo.';
  }
  return 'Sin señal · no se creó todavía. Reintenta: se envía el mismo registro.';
}
