import { Controller, Get } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryModule, DiscoveryService, MetadataScanner } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { Autenticado, Publico, Roles } from '../src/core/index.js';
import { SOLO_AUTENTICADO } from '../src/core/auth/autenticado.decorator.js';
import { RUTA_PUBLICA } from '../src/core/auth/publico.decorator.js';
import { ROLES_PERMITIDOS } from '../src/core/autorizacion/roles.guard.js';
import { AppModule } from '../src/app.module.js';

const marca = (clave: string, controlador: object, handler: object): boolean =>
  Boolean(Reflect.getMetadata(clave, handler) ?? Reflect.getMetadata(clave, controlador));

/**
 * Cada ruta lleva exactamente uno de `@Roles()`, `@Publico()` o
 * `@Autenticado()`. Con dos, el guard atiende al más permisivo y el otro queda
 * de adorno: `@Publico()` deja sin efecto a los demás y `@Autenticado()` a
 * `@Roles()`.
 */
function politicaUnica(controlador: object, handler: object): boolean {
  const marcas = [ROLES_PERMITIDOS, RUTA_PUBLICA, SOLO_AUTENTICADO].filter((clave) =>
    marca(clave, controlador, handler),
  );
  return marcas.length === 1;
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

@Roles('admin_banco')
@Controller('roles-y-autenticado')
class ControladorConRolesYAutenticado {
  @Autenticado()
  @Get()
  consultar() {
    return {};
  }
}

describe('cobertura de autorización de rutas registradas', () => {
  it('detecta una ruta sin @Roles(), @Publico() ni @Autenticado()', () => {
    const handler = ControladorSinPolitica.prototype.consultar;

    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBeDefined();
    expect(politicaUnica(ControladorSinPolitica, handler)).toBe(false);
  });

  it('detecta una ruta con @Roles() y @Publico() a la vez', () => {
    expect(politicaUnica(ControladorConAmbas, ControladorConAmbas.prototype.consultar)).toBe(false);
  });

  it('detecta una ruta con @Roles() y @Autenticado() a la vez', () => {
    expect(
      politicaUnica(
        ControladorConRolesYAutenticado,
        ControladorConRolesYAutenticado.prototype.consultar,
      ),
    ).toBe(false);
  });

  it('cada ruta de AppModule tiene uno de @Roles(), @Publico() o @Autenticado()', async () => {
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
