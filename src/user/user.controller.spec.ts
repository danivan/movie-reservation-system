import { Test, TestingModule } from '@nestjs/testing';
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

  it('findOne should convert the id param to a number', async () => {
    const user = { id: 1, email: 'test@example.com' };
    mockUserService.findOne.mockResolvedValue(user);

    const result = await controller.findOne('1');

    expect(mockUserService.findOne).toHaveBeenCalledWith(1);
    expect(result).toEqual(user);
  });

  it('remove should delegate to the service with a numeric id', async () => {
    mockUserService.remove.mockResolvedValue(undefined);

    await controller.remove('2');

    expect(mockUserService.remove).toHaveBeenCalledWith(2);
  });
});
