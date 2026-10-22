import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Ajv2020, type AnySchemaObject } from 'ajv/dist/2020.js';
import type { EventoV1 } from '@sigba/shared-types';
import { describe, expect, it } from 'vitest';

type ContratoDeEvento = AnySchemaObject & {
  examples?: unknown[];
};

type CatalogoDeEventos = AnySchemaObject & {
  $id: string;
  $defs: Record<string, ContratoDeEvento>;
};

const rutaContratos = fileURLToPath(
  new URL('../../../docs/eventos/contratos.v1.json', import.meta.url),
);
const contratos = JSON.parse(
  readFileSync(path.resolve(rutaContratos), 'utf8'),
) as CatalogoDeEventos;

const LOTE = {
  referenciaId: '00000000-0000-4000-8000-000000000004',
  loteId: '00000000-0000-4000-8000-000000000005',
  cantidad: 2.5,
};
const MEMBRESIA = {
  membresiaId: '00000000-0000-4000-8000-000000000012',
  beneficiarioId: '00000000-0000-4000-8000-000000000013',
  institucionId: '00000000-0000-4000-8000-000000000007',
};

// Uno por tipo de `EventoV1`: si el tipo de shared-types y el esquema se
// separan, falla la compilación o la validación.
const EVENTOS_TIPADOS: { [T in EventoV1['tipo']]: Extract<EventoV1, { tipo: T }> } = {
  RecepcionConfirmada: {
    tipo: 'RecepcionConfirmada',
    version: 1,
    payload: {
      recepcionId: '00000000-0000-4000-8000-000000000001',
      bodegaId: '00000000-0000-4000-8000-000000000002',
      donanteId: '00000000-0000-4000-8000-000000000003',
      origen: 'ABACO',
      detalles: [LOTE],
    },
  },
  SalidaRegistrada: {
    tipo: 'SalidaRegistrada',
    version: 1,
    payload: {
      salidaId: '00000000-0000-4000-8000-000000000006',
      institucionId: '00000000-0000-4000-8000-000000000007',
      bodegaId: '00000000-0000-4000-8000-000000000002',
      despachadorTipo: 'voluntario',
      detalles: [LOTE],
    },
  },
  PrecioActualizado: {
    tipo: 'PrecioActualizado',
    version: 1,
    payload: {
      precioId: '00000000-0000-4000-8000-000000000008',
      referenciaId: '00000000-0000-4000-8000-000000000004',
      valor: '2500.5',
      moneda: 'COP',
      vigenteDesde: '2026-10-12T05:00:00.000Z',
    },
  },
  MembresiaActivada: { tipo: 'MembresiaActivada', version: 1, payload: MEMBRESIA },
  MembresiaCerrada: { tipo: 'MembresiaCerrada', version: 1, payload: MEMBRESIA },
};

describe('contratos de eventos', () => {
  it('acepta un evento escrito con cada tipo de shared-types', () => {
    const ajv = new Ajv2020();
    ajv.addSchema(contratos);

    for (const evento of Object.values(EVENTOS_TIPADOS)) {
      const validar = ajv.getSchema(`${contratos.$id}#/$defs/${evento.tipo}_v${evento.version}`);
      expect(validar, evento.tipo).toBeDefined();
      expect(validar?.(evento), JSON.stringify(validar?.errors)).toBe(true);
    }
  });

  it('publica cinco borradores de M1 y cuatro de M2', () => {
    expect(
      Object.keys(contratos.$defs)
        .filter((nombre) => nombre.endsWith('_v1'))
        .sort(),
    ).toEqual(
      [
        'RecepcionConfirmada_v1',
        'SalidaRegistrada_v1',
        'LoteProximoAVencer_v1',
        'PrecioActualizado_v1',
        'TrasladoConfirmado_v1',
        'MembresiaActivada_v1',
        'MembresiaCerrada_v1',
        'AlertaDuplicidadAbierta_v1',
        'AlertaDuplicidadResuelta_v1',
      ].sort(),
    );
  });

  it('valida los ejemplos y rechaza campos adicionales en el sobre y la carga', () => {
    const ajv = new Ajv2020();
    ajv.addSchema(contratos);

    for (const [nombre, contrato] of Object.entries(contratos.$defs)) {
      if (nombre === 'Uuid' || nombre === 'Cantidad') continue;
      const validar = ajv.getSchema(`${contratos.$id}#/$defs/${nombre}`);
      const ejemplo = contrato.examples?.[0];

      expect(validar).toBeDefined();
      expect(ejemplo).toBeDefined();
      expect(validar?.(ejemplo)).toBe(true);
      expect(
        validar?.({
          ...(ejemplo as Record<string, unknown>),
          campoExtra: 'no permitido',
        }),
      ).toBe(false);

      const sobre = ejemplo as {
        payload: Record<string, unknown>;
      } & Record<string, unknown>;
      expect(
        validar?.({
          ...sobre,
          payload: { ...sobre.payload, campoExtra: 'no permitido' },
        }),
      ).toBe(false);

      const detalles = sobre.payload['detalles'];
      if (Array.isArray(detalles) && detalles.length > 0) {
        expect(
          validar?.({
            ...sobre,
            payload: {
              ...sobre.payload,
              detalles: [
                {
                  ...(detalles[0] as Record<string, unknown>),
                  campoExtra: 'no permitido',
                },
              ],
            },
          }),
        ).toBe(false);
      }
    }
  });

  it('requiere resolución nula solo al descartar una alerta', () => {
    const ajv = new Ajv2020();
    ajv.addSchema(contratos);
    const nombre = 'AlertaDuplicidadResuelta_v1';
    const contrato = contratos.$defs[nombre];
    if (!contrato) throw new Error(`Falta el esquema ${nombre}.`);

    const validar = ajv.getSchema(`${contratos.$id}#/$defs/${nombre}`);
    const ejemploSinTipo = contrato.examples?.[0];
    if (!ejemploSinTipo || typeof ejemploSinTipo !== 'object' || Array.isArray(ejemploSinTipo)) {
      throw new Error(`Falta un ejemplo válido para el esquema ${nombre}.`);
    }
    const ejemplo = ejemploSinTipo as {
      payload: Record<string, unknown>;
    } & Record<string, unknown>;

    if (!validar) throw new Error(`No se pudo compilar el esquema ${nombre}.`);

    expect(
      validar({
        ...ejemplo,
        payload: { ...ejemplo.payload, estado: 'resuelta' },
      }),
    ).toBe(false);
    expect(
      validar({
        ...ejemplo,
        payload: { ...ejemplo.payload, estado: 'resuelta', resolucion: 'mantener' },
      }),
    ).toBe(true);
  });
});
