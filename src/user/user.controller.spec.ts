import { Test, TestingModule } from '@nestjs/testing';
import { ParseIntPipe } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { UserController } from './user.controller';
import { UserService } from './user.service';

describe('UserController', () => {
  let controller: UserController;
  const mockUserService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  // The pipes bound to the `id` route param of a controller method.
  const idParamPipes = (method: string): unknown[] => {
    const args: Record<string, { data?: unknown; pipes?: unknown[] }> =
      Reflect.getMetadata(ROUTE_ARGS_METADATA, UserController, method) ?? {};
    const idArg = Object.values(args).find((arg) => arg.data === 'id');
    return idArg?.pipes ?? [];
  };

  beforeEach(async () => {
    jest.clearAllMocks();

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
    it.each(['findOne', 'update', 'remove'])(
      'should parse the id of %s with ParseIntPipe',
      (method) => {
        expect(idParamPipes(method)).toContain(ParseIntPipe);
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
