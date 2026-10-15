import { Download04Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { PaginaDeAuditoria, RegistroDeAuditoria } from '@sigba/shared-types';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router';
import { SoloPara } from '@/shared/SoloPara.tsx';
import { useAsignacion, usePedir } from '@/shared/sesion.ts';
import { Button } from '@/ui/button';
import {
  consultaParaApi,
  type FiltrosDeAuditoria,
  filtrosDeUrl,
  rangoParaApi,
  urlDeFiltros,
} from './auditoria.ts';
import { BarraDeFiltros } from './BarraDeFiltros.tsx';
import { DetalleDeRegistro } from './DetalleDeRegistro.tsx';
import { LineaDeTiempo } from './LineaDeTiempo.tsx';

/** Descarga el CSV con BOM: `text()` lo quita y sin él Excel rompe las tildes. */
function descargar(csv: string, nombre: string): void {
  const url = URL.createObjectURL(
    new Blob([String.fromCharCode(0xfeff), csv], { type: 'text/csv;charset=utf-8' }),
  );
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  enlace.click();
  URL.revokeObjectURL(url);
}

/**
 * Quién hizo qué y cuándo en el banco (SBA-51). Solo en línea: la auditoría
 * no se guarda en el celular (Arquitectura 8.6).
 */
export function PantallaDeAuditoria() {
  const pedir = usePedir();
  const bancoId = useAsignacion()?.bancoId;
  const [parametros, setParametros] = useSearchParams();
  const filtros = filtrosDeUrl(parametros);
  const [seleccionado, setSeleccionado] = useState<RegistroDeAuditoria>();

  const consulta = useInfiniteQuery({
    queryKey: ['auditoria', bancoId, filtros],
    queryFn: ({ pageParam }) => pedir<PaginaDeAuditoria>(consultaParaApi(filtros, pageParam)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (ultima) => ultima.siguienteCursor ?? undefined,
  });
  const registros = consulta.data?.pages.flatMap((pagina) => pagina.registros) ?? [];

  const exportacion = useMutation({
    mutationFn: async ({ desde, hasta }: { desde: string; hasta: string }) => {
      const csv = await pedir<string>(
        `/auditoria/exportar?${new URLSearchParams(rangoParaApi(desde, hasta))}`,
      );
      descargar(csv, `auditoria_${desde}_${hasta}.csv`);
    },
  });

  const filtrar = useCallback(
    (nuevos: FiltrosDeAuditoria) => {
      setSeleccionado(undefined);
      setParametros(urlDeFiltros(nuevos), { replace: true });
    },
    [setParametros],
  );
  const cerrar = useCallback(() => setSeleccionado(undefined), []);

  const { desde, hasta } = filtros;
  const exportar = (
    <SoloPara roles={['admin_banco']}>
      <Button
        variant="outline"
        size="sm"
        disabled={!desde || !hasta || exportacion.isPending}
        title={desde && hasta ? undefined : 'Elige desde y hasta para exportar'}
        onClick={() => desde && hasta && exportacion.mutate({ desde, hasta })}
      >
        <HugeiconsIcon icon={Download04Icon} aria-hidden />
        {exportacion.isPending ? 'Exportando…' : 'Exportar periodo'}
      </Button>
    </SoloPara>
  );

  return (
    <main className="mx-auto flex max-w-6xl gap-6 px-4 py-6 md:px-6">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Auditoría</h1>
        <BarraDeFiltros filtros={filtros} alCambiar={filtrar} acciones={exportar} />
        {exportacion.isError && (
          <p role="alert" className="text-sm text-destructive">
            No se pudo exportar. Si el periodo es muy largo, acórtalo y vuelve a intentar.
          </p>
        )}

        {consulta.isPending && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {consulta.isError && (
          <p role="alert" className="text-sm text-destructive">
            No se pudo cargar la auditoría. Revisa la señal: esta pantalla necesita conexión.
          </p>
        )}
        {consulta.isSuccess && registros.length === 0 && (
          <p className="text-sm text-muted-foreground">Nada registrado con estos filtros.</p>
        )}

        <LineaDeTiempo
          registros={registros}
          seleccionado={seleccionado?.id}
          alElegir={setSeleccionado}
        />

        {consulta.hasNextPage && (
          <Button
            variant="ghost"
            className="self-center"
            disabled={consulta.isFetchingNextPage}
            onClick={() => void consulta.fetchNextPage()}
          >
            {consulta.isFetchingNextPage ? 'Cargando…' : 'Ver anteriores'}
          </Button>
        )}
      </div>

      {seleccionado && (
        <DetalleDeRegistro
          registro={seleccionado}
          alCerrar={cerrar}
          alFiltrarActor={(actor) => filtrar({ ...filtros, actor })}
          alFiltrarEntidad={(entidad) => filtrar({ ...filtros, entidad })}
        />
      )}
    </main>
  );
}
