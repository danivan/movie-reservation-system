import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from 'src/decorators/role.decorator';
import { Role } from 'src/types';
import { RolesGuard } from './role.guard';
import { spyOnAllLogging } from '../../test/utils/spy-on-logging';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let logging: ReturnType<typeof spyOnAllLogging>;
  const mockReflector = {
    getAllAndOverride: jest.fn(),
  };

  // Stand-ins for the route handler and its controller class.
  const handler = () => undefined;
  class TestController {}

  // The request user shape JwtStrategy.validate produces.
  type RequestUser = { id: number; username: string; isAdmin: boolean };
  const makeUser = (overrides: Partial<RequestUser> = {}): RequestUser => ({
    id: 1,
    username: 'a@x.dev',
    isAdmin: false,
    ...overrides,
  });

  const makeContext = (user: unknown): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => TestController,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [RolesGuard, { provide: Reflector, useValue: mockReflector }],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
    // Spy after compile so only canActivate() is inside the spy window.
    logging = spyOnAllLogging();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('canActivate', () => {
    it('should allow when no roles are required', () => {
      mockReflector.getAllAndOverride.mockReturnValue(undefined);

      const result = guard.canActivate(makeContext(makeUser()));

      expect(result).toBe(true);
      expect(mockReflector.getAllAndOverride).toHaveBeenCalledWith(ROLES_KEY, [
        handler,
        TestController,
      ]);
    });

    it('should allow an admin on an admin route', () => {
      mockReflector.getAllAndOverride.mockReturnValue([Role.ADMIN]);

      const result = guard.canActivate(
        makeContext(makeUser({ isAdmin: true })),
      );

      expect(result).toBe(true);
    });

    it('should deny a non-admin on an admin route', () => {
      mockReflector.getAllAndOverride.mockReturnValue([Role.ADMIN]);

      const result = guard.canActivate(
        makeContext(makeUser({ isAdmin: false })),
      );

      expect(result).toBe(false);
    });

    it('should allow a non-admin on a user route', () => {
      mockReflector.getAllAndOverride.mockReturnValue([Role.USER]);

      const result = guard.canActivate(
        makeContext(makeUser({ isAdmin: false })),
      );

      expect(result).toBe(true);
    });

    it('should not log the request user on any console or Nest Logger channel', () => {
      mockReflector.getAllAndOverride.mockReturnValue([Role.ADMIN]);

      guard.canActivate(makeContext(makeUser({ isAdmin: true })));

      logging.expectNoLogging();
    });
  });
});
