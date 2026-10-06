import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createExtendedPrismaClient, type ExtendedPrismaClient } from './prisma-rls.extension.js';

/**
 * Servicio centralizado de conexión a PostgreSQL vía Prisma (ADR-05).
 * Provee acceso al cliente extendido con soporte para transacciones con RLS
 * y maneja el ciclo de vida de la conexión.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private _extendedClient?: ExtendedPrismaClient;

  constructor() {
    super({ datasourceUrl: process.env['API_DATABASE_URL'] ?? process.env['DATABASE_URL'] });
  }

  async onModuleInit(): Promise<void> {
    // Sin DATABASE_URL no hay nada que conectar: es el caso de las pruebas
    // unitarias, que no tocan la base.
    if (!process.env['DATABASE_URL']) return;

    // Y si la hay, un fallo de conexión tiene que romper el arranque. Tragarlo
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
