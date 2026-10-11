import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import type { IdentidadDeAutenticacion } from './resolutor-de-identidad.js';
import type { TokenVerifier } from './token-verifier.js';

type Request = {
  headers: Record<string, string | string[] | undefined>;
  identidad?: IdentidadDeAutenticacion;
};

function executionContext(request: Request) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as never;
}

describe('JwtAuthGuard', () => {
  it.each([undefined, 'Basic abc', 'Bearer', 'Bearer a b'])(
    'rechaza la cabecera %s sin verificar ni resolver identidad',
    async (authorization) => {
      const verifier: TokenVerifier = { verify: vi.fn() };
      const guard = new JwtAuthGuard(new Reflector(), verifier);
      const request: Request = { headers: authorization ? { authorization } : {} };

      await expect(guard.canActivate(executionContext(request))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(verifier.verify).not.toHaveBeenCalled();
      expect(request.identidad).toBeUndefined();
    },
  );

  it('convierte cualquier error del verificador en 401 sin revelar su causa', async () => {
    const verifier: TokenVerifier = {
      verify: vi.fn().mockRejectedValue(new Error('signature details must stay private')),
    };
    const guard = new JwtAuthGuard(new Reflector(), verifier);
    const request: Request = { headers: { authorization: 'Bearer invalid-token' } };

    try {
      await guard.canActivate(executionContext(request));
      throw new Error('Se esperaba UnauthorizedException');
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as Error).message).not.toContain('signature details');
    }
    expect(verifier.verify).toHaveBeenCalledWith('invalid-token');
    expect(request.identidad).toBeUndefined();
  });

  it('adjunta solo la identidad verificada que consumirá RolesGuard', async () => {
    const verifier: TokenVerifier = {
      verify: vi.fn().mockResolvedValue({ auth0Sub: 'auth0|synthetic-user', emisor: 'issuer' }),
    };
    const guard = new JwtAuthGuard(new Reflector(), verifier);
    const request: Request = { headers: { authorization: 'Bearer valid-token' } };

    await expect(guard.canActivate(executionContext(request))).resolves.toBe(true);
    expect(request.identidad).toEqual({ auth0Sub: 'auth0|synthetic-user', emisor: 'issuer' });
  });
});
