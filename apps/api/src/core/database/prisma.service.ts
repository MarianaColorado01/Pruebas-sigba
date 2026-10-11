import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createExtendedPrismaClient, type ExtendedPrismaClient } from './prisma-rls.extension.js';

function opcionesConexionApi() {
  const url = process.env['API_DATABASE_URL'];
  if (!url && process.env['DATABASE_URL']) {
    throw new Error('Configura API_DATABASE_URL con las credenciales del rol sigba_app.');
  }
  return url ? { datasourceUrl: url } : {};
}

/**
 * Servicio centralizado de conexión a PostgreSQL vía Prisma (ADR-05).
 * Provee acceso al cliente extendido con soporte para transacciones con RLS
 * y maneja el ciclo de vida de la conexión.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private _extendedClient?: ExtendedPrismaClient;

  constructor() {
    super(opcionesConexionApi());
  }

  async onModuleInit(): Promise<void> {
    // Sin API_DATABASE_URL no hay nada que conectar: es el caso de las pruebas
    // unitarias, que no tocan la base.
    if (!process.env['API_DATABASE_URL']) return;

    // Un fallo de conexión tiene que romper el arranque. Tragarlo
    // deja la API en pie sin base de datos, la sonda de Fly.io responde OK y el
    // despliegue queda verde mientras falla cada petición.
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Retorna la instancia de Prisma extendida con el helper $transactionWithTenant
   */
  get client(): ExtendedPrismaClient {
    if (!this._extendedClient) {
      this._extendedClient = createExtendedPrismaClient(this);
    }
    return this._extendedClient;
  }
}
