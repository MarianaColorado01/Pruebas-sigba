import { useState } from 'react';
import { cn } from 'cn';
import { uuidv7 } from '@/offline/uuidv7.ts';
import type { ReferenciaDelCatalogo } from '@/shared/catalogo.ts';
import { ErrorDeApi } from '@/shared/clienteHttp.ts';
import { SoloPara } from '@/shared/SoloPara.tsx';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { buscarEnCatalogo, useCatalogo } from '../useCatalogo.ts';
import {
  type AprobacionDePrecio,
  FUENTES,
  type Fuente,
  type Precio,
  type PropuestaDePrecio,
  useEscribirPrecio,
  usePreciosDeReferencia,
} from './datos.ts';

/** Los mismos que exige `@Roles()` para proponer y aprobar. */
const ROLES_DE_ESCRITURA = ['coordinacion', 'admin_banco'] as const;

const NOMBRE_DE_FUENTE: Record<Fuente, string> = {
  remision: 'Remisión',
  sipsa: 'SIPSA',
  catalogo: 'Catálogo',
  manual: 'Manual',
};

const NOMBRE_DE_ESTADO: Record<Precio['estado'], string> = {
  propuesto: 'Propuesto',
  aprobado: 'Aprobado',
  vencido: 'Vencido',
};

const PESOS = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 2,
});

const MAXIMO_DE_SUGERENCIAS = 6;

/**
 * Maestro de precios por referencia genérica (SBA-82, RF-M1-14). Muestra el
 * precio vigente de hoy y el historial; la coordinación propone con banda,
 * fuente, evidencia y vigencia, y aprueba. Sin precio vigente aprobado, las
 * recepciones quedan con valoración pendiente (ADR-13).
 */
export function PreciosPage() {
  const catalogo = useCatalogo();
  const [texto, setTexto] = useState('');
  const [referencia, setReferencia] = useState<ReferenciaDelCatalogo | null>(null);

  const sugerencias =
    catalogo.data && texto.trim()
      ? buscarEnCatalogo(catalogo.data.catalogo, texto).slice(0, MAXIMO_DE_SUGERENCIAS)
      : [];

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Precios</h1>
        <p className="text-muted-foreground">
          Un precio vigente por producto y presentación, con banda e historial.
        </p>
      </header>

      {referencia ? (
        <div className="flex items-center justify-between gap-3 rounded-md border p-3">
          <span className="text-lg font-medium">
            {referencia.producto.nombre} {referencia.presentacion}
          </span>
          <Button variant="outline" size="lg" onClick={() => setReferencia(null)}>
            Cambiar
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Input
            aria-label="Buscar referencia"
            placeholder="Producto o presentación"
            className="h-12 text-base"
            value={texto}
            onChange={(evento) => setTexto(evento.target.value)}
          />
          {sugerencias.map((sugerida) => (
            <Button
              key={sugerida.id}
              variant="outline"
              className="h-auto min-h-12 justify-start py-3 text-left text-base whitespace-normal"
              onClick={() => {
                setReferencia(sugerida);
                setTexto('');
              }}
            >
              {sugerida.producto.nombre} {sugerida.presentacion}
            </Button>
          ))}
        </div>
      )}

      {referencia && <PreciosDeReferencia key={referencia.id} referenciaId={referencia.id} />}
    </div>
  );
}

function PreciosDeReferencia({ referenciaId }: { referenciaId: string }) {
  const { historial, vigente } = usePreciosDeReferencia(referenciaId);
  const precio = vigente.data?.precio;

  return (
    <>
      <section className="flex flex-col gap-2 rounded-lg border p-4" aria-labelledby="vigente">
        <h2 id="vigente" className="text-lg font-semibold">
          Vigente hoy
        </h2>
        {vigente.isPending && <p>Consultando…</p>}
        {vigente.isError && <p role="alert">No se pudo consultar el precio vigente.</p>}
        {vigente.data &&
          (precio ? (
            <>
              <p className="text-2xl font-semibold">{PESOS.format(Number(precio.valor))}</p>
              <DetalleDePrecio precio={precio} />
            </>
          ) : (
            <p>
              Sin precio vigente aprobado. Las recepciones de hoy quedan con valoración pendiente.
            </p>
          ))}
      </section>

      <SoloPara roles={ROLES_DE_ESCRITURA}>
        <Proponer referenciaId={referenciaId} />
      </SoloPara>

      <section className="flex flex-col gap-2" aria-labelledby="historial">
        <h2 id="historial" className="text-lg font-semibold">
          Historial
        </h2>
        {historial.isError && <p role="alert">No se pudo consultar el historial.</p>}
        {historial.data?.length === 0 && <p>Esta referencia todavía no tiene precios.</p>}
        <ul className="flex flex-col gap-2">
          {historial.data?.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 rounded-md border p-3">
              <span className="flex items-center justify-between gap-2">
                <span className="text-lg font-medium">{PESOS.format(Number(p.valor))}</span>
                <span
                  className={cn(
                    'rounded-sm px-2 py-0.5 text-sm font-medium',
                    p.estado === 'aprobado'
                      ? 'bg-primary/10 text-foreground'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {NOMBRE_DE_ESTADO[p.estado]}
                </span>
              </span>
              <DetalleDePrecio precio={p} />
              {p.estado === 'propuesto' && (
                <SoloPara roles={ROLES_DE_ESCRITURA}>
                  <Aprobar precio={p} />
                </SoloPara>
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function DetalleDePrecio({ precio }: { precio: Precio }) {
  return (
    <span className="flex flex-col text-sm text-muted-foreground">
      <span>
        Banda {PESOS.format(Number(precio.piso))} a {PESOS.format(Number(precio.techo))} ·{' '}
        {NOMBRE_DE_FUENTE[precio.fuente]}
      </span>
      <span>
        Del {fecha(precio.vigenteDesde)}
        {precio.vigenteHasta ? ` al ${fecha(precio.vigenteHasta)}` : ''}
      </span>
      <span>Evidencia: {precio.evidencia}</span>
      {precio.motivoFueraDeBanda && <span>Fuera de banda: {precio.motivoFueraDeBanda}</span>}
    </span>
  );
}

function Proponer({ referenciaId }: { referenciaId: string }) {
  const { proponer } = useEscribirPrecio();
  const [valor, setValor] = useState('');
  const [piso, setPiso] = useState('');
  const [techo, setTecho] = useState('');
  const [fuente, setFuente] = useState<Fuente | null>(null);
  const [evidencia, setEvidencia] = useState('');
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState('');
  const [propuesta, setPropuesta] = useState<PropuestaDePrecio | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  function cambio(asignar: (valor: string) => void) {
    return (valor: string) => {
      asignar(valor);
      setPropuesta(null);
      setAviso(null);
    };
  }

  function enviar() {
    if (!valor || !piso || !techo || !fuente || !evidencia.trim() || !desde) {
      return setAviso('Llena valor, piso, techo, fuente, evidencia y desde cuándo rige.');
    }
    const aEnviar = propuesta ?? {
      comandoId: uuidv7(),
      referenciaId,
      valor: pesos(valor),
      piso: pesos(piso),
      techo: pesos(techo),
      fuente,
      evidencia: evidencia.trim(),
      vigenteDesde: desde,
      vigenteHasta: hasta || null,
    };
    setPropuesta(aEnviar);
    setAviso(null);
    proponer.mutate(aEnviar, {
      onSuccess: () => {
        setPropuesta(null);
        setValor('');
        setPiso('');
        setTecho('');
        setEvidencia('');
        setHasta('');
        setAviso('Precio propuesto. Falta aprobarlo para que rija.');
      },
      onError: (error) => setAviso(motivo(error)),
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4" aria-labelledby="proponer">
      <h2 id="proponer" className="text-lg font-semibold">
        Proponer precio
      </h2>
      <div className="grid grid-cols-3 gap-2">
        <CampoDePesos etiqueta="Valor" valor={valor} onCambio={cambio(setValor)} />
        <CampoDePesos etiqueta="Piso" valor={piso} onCambio={cambio(setPiso)} />
        <CampoDePesos etiqueta="Techo" valor={techo} onCambio={cambio(setTecho)} />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-medium">Fuente</legend>
        <div className="grid grid-cols-2 gap-2">
          {FUENTES.map((opcion) => (
            <Button
              key={opcion}
              variant="outline"
              size="lg"
              aria-pressed={fuente === opcion}
              className={cn(fuente === opcion && 'border-primary bg-primary/10')}
              onClick={() => {
                setFuente(opcion);
                setPropuesta(null);
              }}
            >
              {NOMBRE_DE_FUENTE[opcion]}
            </Button>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-2 font-medium">
        Evidencia
        <Input
          placeholder="Ej. Remisión 4521 de Almacén La 14"
          className="h-12 text-base"
          value={evidencia}
          onChange={(evento) => cambio(setEvidencia)(evento.target.value)}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-2 font-medium">
          Rige desde
          <Input
            type="date"
            className="h-12 text-base"
            value={desde}
            onChange={(evento) => cambio(setDesde)(evento.target.value)}
          />
        </label>
        <label className="flex flex-col gap-2 font-medium">
          Hasta
          <Input
            type="date"
            className="h-12 text-base"
            value={hasta}
            onChange={(evento) => cambio(setHasta)(evento.target.value)}
          />
        </label>
      </div>
      <p className="text-sm text-muted-foreground">Sin fecha final, rige 30 días.</p>
      {aviso && <p role={proponer.isError ? 'alert' : 'status'}>{aviso}</p>}
      <Button size="lg" disabled={proponer.isPending} onClick={enviar}>
        {proponer.isPending ? 'Enviando…' : propuesta ? 'Reintentar' : 'Proponer precio'}
      </Button>
    </section>
  );
}

function CampoDePesos({
  etiqueta,
  valor,
  onCambio,
}: {
  etiqueta: string;
  valor: string;
  onCambio: (valor: string) => void;
}) {
  return (
    <label className="flex flex-col gap-2 font-medium">
      {etiqueta}
      <Input
        inputMode="decimal"
        placeholder="$"
        className="h-12 text-base"
        value={valor}
        onChange={(evento) => onCambio(evento.target.value)}
      />
    </label>
  );
}

function Aprobar({ precio }: { precio: Precio }) {
  const { aprobar } = useEscribirPrecio();
  const fueraDeBanda =
    Number(precio.valor) < Number(precio.piso) || Number(precio.valor) > Number(precio.techo);
  const [motivoFuera, setMotivoFuera] = useState('');
  const [aprobacion, setAprobacion] = useState<AprobacionDePrecio | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  function enviar() {
    if (fueraDeBanda && !motivoFuera.trim()) {
      return setAviso('El valor está fuera de la banda. Escribe el motivo para aprobarlo.');
    }
    const aEnviar = aprobacion ?? {
      comandoId: uuidv7(),
      precioId: precio.id,
      motivoFueraDeBanda: fueraDeBanda ? motivoFuera.trim() : null,
    };
    setAprobacion(aEnviar);
    setAviso(null);
    aprobar.mutate(aEnviar, { onError: (error) => setAviso(motivo(error)) });
  }

  return (
    <div className="flex flex-col gap-2">
      {fueraDeBanda && (
        <label className="flex flex-col gap-2 font-medium">
          Motivo fuera de banda
          <Input
            className="h-12 text-base"
            value={motivoFuera}
            onChange={(evento) => {
              setMotivoFuera(evento.target.value);
              setAprobacion(null);
              setAviso(null);
            }}
          />
        </label>
      )}
      {aviso && <p role="alert">{aviso}</p>}
      <Button size="lg" disabled={aprobar.isPending} onClick={enviar}>
        {aprobar.isPending ? 'Aprobando…' : aprobacion ? 'Reintentar' : 'Aprobar precio'}
      </Button>
    </div>
  );
}

/** Hoy en Colombia, AAAA-MM-DD: el día del Banco no cambia a medianoche UTC. */
function hoy(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

/**
 * Pesos como los escribe la gente a punto de miles: «2.500,50», «2.500» y
 * «2500,5» llegan a la API como 2500.50, 2500 y 2500.5.
 */
function pesos(texto: string): string {
  const limpio = texto.replace(/[$\s]/g, '');
  if (limpio.includes(',')) return limpio.replace(/\./g, '').replace(',', '.');
  return /^\d{1,3}(\.\d{3})+$/.test(limpio) ? limpio.replace(/\./g, '') : limpio;
}

/** AAAA-MM-DD a DD/MM/AAAA sin pasar por Date, que lo correría de día según la zona. */
function fecha(dia: string): string {
  const [anio, mes, d] = dia.split('-');
  return `${d}/${mes}/${anio}`;
}

function motivo(error: unknown): string {
  if (error instanceof ErrorDeApi) {
    if (error.estado === 403) return 'Tu rol no puede proponer ni aprobar precios.';
    // 400, 404 y 409 traen el motivo en español: banda, evidencia, vigencia que se cruza.
    if ([400, 404, 409].includes(error.estado)) return error.message;
    return 'No se pudo guardar. Inténtalo de nuevo.';
  }
  return 'Sin señal · no se guardó todavía. Reintenta: se envía el mismo registro.';
}
