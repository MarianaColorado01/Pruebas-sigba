import { UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { describe, expect, it, vi } from 'vitest';
import { JwtStrategy } from './jwt.strategy.js';

describe('JwtStrategy', () => {
  it('resuelve el usuario y el banco desde auth0_sub', async () => {
    const findUnique = vi.fn().mockResolvedValue({
          id: '1b0c8d3a-0000-4000-8000-000000000001',
          auth0_sub: 'auth0|user-123',
          banco_id: '2b0c8d3a-0000-4000-8000-000000000002',
        });
    const prisma = { usuario: { findUnique } } as unknown as PrismaService;

    const strategy = new JwtStrategy(prisma);

    await expect(
      strategy.validate({
        sub: 'auth0|user-123',
        roles: ['institucion', 'consulta'],
        institucion_id: '3b0c8d3a-0000-4000-8000-000000000003',
      }),
    ).resolves.toEqual({
      id: '1b0c8d3a-0000-4000-8000-000000000001',
      auth0_sub: 'auth0|user-123',
      banco_id: '2b0c8d3a-0000-4000-8000-000000000002',
      roles: ['institucion', 'consulta'],
      institucion_id: '3b0c8d3a-0000-4000-8000-000000000003',
    });

    expect(prisma.usuario.findUnique).toHaveBeenCalledWith({
      where: { auth0_sub: 'auth0|user-123' },
      select: {
        id: true,
        auth0_sub: true,
        banco_id: true,
      },
    });
  });

  it('rechaza un token sin sub válido', async () => {
    const findUnique = vi.fn();
    const strategy = new JwtStrategy(
      { usuario: { findUnique } } as unknown as PrismaService,
    );

    await expect(
      strategy.validate({
        roles: ['consulta'],
      }),
    ).rejects.toThrow(UnauthorizedException);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rechaza un usuario no registrado en SIGBA', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const prisma = { usuario: { findUnique } } as unknown as PrismaService;

    const strategy = new JwtStrategy(prisma);

    await expect(
      strategy.validate({
        sub: 'auth0|missing-user',
      }),
    ).rejects.toThrow('Usuario autenticado pero no registrado en SIGBA');
  });
});
