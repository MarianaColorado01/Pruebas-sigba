import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Ajv2020, type AnySchemaObject } from 'ajv/dist/2020.js';
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

describe('contratos de eventos', () => {
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
