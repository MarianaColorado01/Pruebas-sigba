import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { stockDb, type StockGuardado } from '@/offline/stockDb.ts';
import { ErrorDeApi } from '@/shared/clienteHttp.ts';
import type { LoteEnStock } from '@/shared/stock.ts';
import { useAsignacion, usePedir } from '@/shared/sesion.ts';

export interface StockEnPantalla {
  lotes: LoteEnStock[];
  /** Cuándo recibió el dispositivo este dato de la API. */
  obtenidoEn: string;
  desactualizado: boolean;
}

export const STOCK_QUERY_KEY = ['inventario', 'stock'] as const;

/**
 * Todo el stock del banco, filtrado en pantalla: así los filtros siguen
 * funcionando sin red sobre la última copia (ADR-10). Mientras la pantalla
 * muestre la copia y no la respuesta de la API, avisa que puede estar
 * desactualizada.
 */
export function useStock() {
  const bancoId = useAsignacion()?.bancoId ?? null;
  const pedir = usePedir();
  const cliente = useQueryClient();
  const [cacheInicial, setCacheInicial] = useState<
    { bancoId: string; data: StockEnPantalla } | undefined
  >();

  useEffect(() => {
    let vigente = true;
    if (bancoId) {
      void stockDb.leer(bancoId).then(
        (guardado) => {
          if (!vigente || !guardado) return;
          const dato = aPantalla(guardado, true);
          setCacheInicial({ bancoId, data: dato });
          // Si la API ya respondió, su dato vale más que la copia.
          cliente.setQueryData<StockEnPantalla>(
            [...STOCK_QUERY_KEY, bancoId],
            (actual) => actual ?? dato,
          );
        },
        () => undefined,
      );
    }
    return () => {
      vigente = false;
    };
  }, [bancoId, cliente]);

  const consulta = useQuery({
    queryKey: [...STOCK_QUERY_KEY, bancoId],
    enabled: Boolean(bancoId),
    staleTime: 0,
    queryFn: async (): Promise<StockEnPantalla> => {
      if (!bancoId) throw new Error('La sesión no tiene un banco activo.');
      let lotes: LoteEnStock[];
      try {
        lotes = await pedir<LoteEnStock[]>('/stock');
      } catch (error) {
        if (error instanceof ErrorDeApi) throw error;
        const guardado = await stockDb.leer(bancoId).catch(() => undefined);
        if (!guardado) throw error;
        return aPantalla(guardado, true);
      }
      const guardado = { bancoId, lotes, obtenidoEn: new Date().toISOString() };
      try {
        await stockDb.guardar(guardado);
      } catch {
        // Una falla local no invalida la respuesta que ya entregó la API.
      }
      return aPantalla(guardado, false);
    },
  });

  const datoLocal = cacheInicial?.bancoId === bancoId ? cacheInicial.data : undefined;
  const data = consulta.data ?? datoLocal;
  // Si la última consulta falló, lo que queda en pantalla ya no es la
  // respuesta de la API, aunque lo haya sido (ADR-10): se avisa y se
  // recalcula con el día de hoy, que puede no ser el de esa respuesta.
  const enPantalla = useMemo(
    () => (data && consulta.isError ? aPantalla(data, true) : data),
    [data, consulta.isError],
  );
  return { ...consulta, data: enPantalla };
}

function aPantalla(
  { lotes, obtenidoEn }: Pick<StockGuardado, 'lotes' | 'obtenidoEn'>,
  desactualizado: boolean,
): StockEnPantalla {
  if (!desactualizado) return { lotes, obtenidoEn, desactualizado };
  // La copia trae el estado del día en que se leyó: un lote que venció desde
  // entonces se ve vencido aunque no haya red. Los días se recalculan; el
  // semáforo queda el último conocido, porque los umbrales viven en la API.
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
  return {
    lotes: lotes.map((lote) => {
      if (lote.vencimiento === null) {
        return { ...lote, estado: 'sin_vencimiento', diasParaVencer: null, semaforo: null };
      }
      const dias = Math.round((Date.parse(lote.vencimiento) - Date.parse(hoy)) / 86_400_000);
      return {
        ...lote,
        estado: dias < 0 ? 'vencido' : 'vigente',
        diasParaVencer: dias,
        // Una copia anterior a SBA-37 no trae semáforo.
        semaforo: dias < 0 ? null : (lote.semaforo ?? null),
      };
    }),
    obtenidoEn,
    desactualizado,
  };
}
