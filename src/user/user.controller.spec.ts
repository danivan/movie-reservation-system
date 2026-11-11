import { Test, TestingModule } from '@nestjs/testing';
import {
  CUSTOM_ROUTE_ARGS_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { ParseIdPipe } from 'src/pipes/parse-id.pipe';
import { ROLES_KEY } from 'src/decorators/role.decorator';
import { Role } from 'src/types';
import { UserController } from './user.controller';
import { UserService } from './user.service';

type RouteArg = {
  data?: unknown;
  pipes?: unknown[];
  factory?: (data: unknown, ctx: unknown) => unknown;
};

describe('UserController', () => {
  let controller: UserController;
  const mockUserService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  // The metadata key and entry of the `id` route arg of a controller method.
  const idRouteArg = (method: string): [string, RouteArg] | undefined => {
    const args: Record<string, RouteArg> =
      Reflect.getMetadata(ROUTE_ARGS_METADATA, UserController, method) ?? {};
    return Object.entries(args).find(([, arg]) => arg.data === 'id');
  };

  // A minimal HTTP context whose request carries the given raw route params.
  const httpContextWithParams = (params: Record<string, string>) => ({
    switchToHttp: () => ({ getRequest: () => ({ params }) }),
  });

  beforeEach(async () => {
    // resetAllMocks so no implementation or *Once queue leaks between tests;
    // each test stubs the service calls it relies on.
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [{ provide: UserService, useValue: mockUserService }],
    }).compile();

    controller = module.get<UserController>(UserController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('id param', () => {
    const ID_METHODS = ['findOne', 'update', 'remove'];

    // A custom decorator is skipped by the global ValidationPipe, so the raw
    // string (not `+value`) reaches ParseIdPipe.
    it.each(ID_METHODS)(
      'should bind the id of %s as a custom route arg',
      (method) => {
        const key = idRouteArg(method)?.[0];

        expect(key).toEqual(
          expect.stringContaining(CUSTOM_ROUTE_ARGS_METADATA),
        );
      },
    );

    it.each(ID_METHODS)(
      'should parse the id of %s with ParseIdPipe',
      (method) => {
        const pipes = idRouteArg(method)?.[1].pipes ?? [];

        expect(
          pipes.some((p) => p === ParseIdPipe || p instanceof ParseIdPipe),
        ).toBe(true);
      },
    );

    it.each(ID_METHODS)(
      'should extract the raw id string of %s from the request params',
      (method) => {
        const arg = idRouteArg(method)?.[1];
        const ctx = httpContextWithParams({ id: '0x10' });

        expect(typeof arg?.factory).toBe('function');
        expect(arg?.factory?.('id', ctx)).toBe('0x10');
      },
    );
  });

  describe('roles', () => {
    // RolesGuard reads this metadata; the e2e authorization tests cover the
    // guard itself.
    it.each(['create', 'update', 'remove'] as const)(
      'should restrict %s to admins',
      (method) => {
        const roles = Reflect.getMetadata(
          ROLES_KEY,
          UserController.prototype[method],
        );

        expect(roles).toEqual([Role.ADMIN]);
      },
    );
  });

  describe('findOne', () => {
    it('should pass the numeric id to the service and return its user', async () => {
      const user = { id: 1, email: 'test@example.com' };
      mockUserService.findOne.mockResolvedValue(user);

      const result = await controller.findOne(1);

      expect(mockUserService.findOne).toHaveBeenCalledWith(1);
      expect(result).toEqual(user);
    });
  });

  describe('update', () => {
    it('should pass the numeric id and dto to the service', async () => {
      const dto = { firstname: 'Renamed' };
      mockUserService.update.mockResolvedValue({ id: 1, firstname: 'Renamed' });

      await controller.update(1, dto);

      expect(mockUserService.update).toHaveBeenCalledWith(1, dto);
    });

    it('should return what the service returns', async () => {
      const updated = { id: 1, email: 'test@example.com', firstname: 'New' };
      mockUserService.update.mockResolvedValue(updated);

      const result = await controller.update(1, { firstname: 'New' });

      expect(result).toEqual(updated);
    });
  });

  describe('remove', () => {
    it('should delegate to the service with the numeric id', async () => {
      mockUserService.remove.mockResolvedValue(undefined);

      await controller.remove(2);

      expect(mockUserService.remove).toHaveBeenCalledWith(2);
    });
  });
});
