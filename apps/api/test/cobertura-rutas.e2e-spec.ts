import { Controller, Get } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryModule, DiscoveryService, MetadataScanner } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { Publico, Roles } from '../src/core/index.js';
import { RUTA_PUBLICA } from '../src/core/auth/publico.decorator.js';
import { ROLES_PERMITIDOS } from '../src/core/autorizacion/roles.guard.js';
import { AppModule } from '../src/app.module.js';

const marca = (clave: string, controlador: object, handler: object): boolean =>
  Boolean(Reflect.getMetadata(clave, handler) ?? Reflect.getMetadata(clave, controlador));

/**
 * Cada ruta lleva `@Roles()` o `@Publico()`, nunca las dos: con ambas, la
 * marca pública gana en los guards y los roles quedan de adorno.
 */
function politicaUnica(controlador: object, handler: object): boolean {
  return (
    marca(ROLES_PERMITIDOS, controlador, handler) !== marca(RUTA_PUBLICA, controlador, handler)
  );
}

@Controller('sin-politica')
class ControladorSinPolitica {
  @Get()
  consultar() {
    return {};
  }
}

@Publico()
@Controller('con-ambas')
class ControladorConAmbas {
  @Roles('admin_banco')
  @Get()
  consultar() {
    return {};
  }
}

describe('cobertura de autorización de rutas registradas', () => {
  it('detecta una ruta sin @Roles() ni @Publico()', () => {
    const handler = ControladorSinPolitica.prototype.consultar;

    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBeDefined();
    expect(politicaUnica(ControladorSinPolitica, handler)).toBe(false);
  });

  it('detecta una ruta con @Roles() y @Publico() a la vez', () => {
    expect(politicaUnica(ControladorConAmbas, ControladorConAmbas.prototype.consultar)).toBe(false);
  });

  it('cada ruta de AppModule tiene @Roles() o @Publico(), y solo uno', async () => {
    const testingModule = await Test.createTestingModule({
      imports: [DiscoveryModule, AppModule],
    }).compile();
    const app = testingModule.createNestApplication();
    await app.init();

    try {
      const discovery = app.get(DiscoveryService);
      const scanner = app.get(MetadataScanner);
      const rutas = discovery.getControllers().flatMap(({ instance, metatype }) => {
        if (!instance || !metatype) return [];
        const prototype = Object.getPrototypeOf(instance) as object;

        return scanner.getAllMethodNames(prototype).flatMap((nombre) => {
          const handler = (instance as Record<string, object>)[nombre];
          if (!handler) return [];
          if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) return [];
          return [
            {
              nombre: `${metatype.name}.${nombre}`,
              cubierta: politicaUnica(metatype, handler),
            },
          ];
        });
      });

      expect(rutas.length).toBeGreaterThan(0);
      expect(rutas.filter((ruta) => !ruta.cubierta).map((ruta) => ruta.nombre)).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
