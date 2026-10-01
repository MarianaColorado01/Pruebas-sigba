import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

type UsuarioFindUniqueArgs = {
  where: { auth0_sub: string };
  select: {
    id: true;
    auth0_sub: true;
    banco_id: true;
  };
};

type UsuarioModel = {
  findUnique: (args: UsuarioFindUniqueArgs) => Promise<{
    id: string;
    auth0_sub: string;
    banco_id: string;
  } | null>;
};

type PrismaClientLike = {
  usuario: UsuarioModel;
  $connect: () => Promise<void>;
  $disconnect: () => Promise<void>;
};

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly client: PrismaClientLike = {
    usuario: {
      findUnique: async () => null,
    },
    $connect: async () => undefined,
    $disconnect: async () => undefined,
  };

  get usuario() {
    return this.client.usuario;
  }

  async onModuleInit() {
    await this.client.$connect();
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
