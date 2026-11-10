import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UserService } from './user.service';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';

jest.mock('bcrypt');

describe('UserService', () => {
  let service: UserService;
  const mockUserRepository = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOneBy: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const mockConfigService = {
    get: jest.fn(),
  };

  const makeCreateUserDto = (
    overrides: Partial<CreateUserDto> = {},
  ): CreateUserDto => ({
    firstname: 'John',
    lastname: 'Doe',
    email: 'john@example.com',
    password: 'plain-password',
    ...overrides,
  });

  const buildService = async (): Promise<UserService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getRepositoryToken(User), useValue: mockUserRepository },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    return module.get<UserService>(UserService);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-pw');
    // No JWT_SALT_OR_ROUNDS configured by default, so the fallback (10) applies.
    mockConfigService.get.mockReturnValue(undefined);
    // Pass-through so whatever the service hands to create() reaches save().
    mockUserRepository.create.mockImplementation((data) => ({ ...data }));

    service = await buildService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findOne', () => {
    it('should return the user when found', async () => {
      const user = { id: 1, email: 'test@example.com' };
      mockUserRepository.findOneBy.mockResolvedValue(user);

      await expect(service.findOne(1)).resolves.toEqual(user);
      expect(mockUserRepository.findOneBy).toHaveBeenCalledWith({ id: 1 });
    });

    it('should throw NotFoundException when the user does not exist', async () => {
      mockUserRepository.findOneBy.mockResolvedValue(null);

      await expect(service.findOne(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should return the saved user', async () => {
      const saved = { id: 1, email: 'john@example.com' };
      mockUserRepository.save.mockResolvedValue(saved);

      await expect(service.create(makeCreateUserDto())).resolves.toEqual(saved);
    });

    it('should hash the password before saving', async () => {
      mockUserRepository.save.mockResolvedValue({ id: 1 });

      await service.create(makeCreateUserDto());

      expect(bcrypt.hash).toHaveBeenCalledWith('plain-password', 10);
      expect(mockUserRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'john@example.com',
          password: 'hashed-pw',
        }),
      );
      expect(mockUserRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ password: 'plain-password' }),
      );
      expect(mockUserRepository.save).not.toHaveBeenCalledWith(
        expect.objectContaining({ password: 'plain-password' }),
      );
    });

    it('should use JWT_SALT_OR_ROUNDS for the salt rounds', async () => {
      mockConfigService.get.mockImplementation((key: string) =>
        key === 'JWT_SALT_OR_ROUNDS' ? '12' : undefined,
      );
      // Rebuild so a service that reads config at construction sees '12'.
      const configuredService = await buildService();
      mockUserRepository.save.mockResolvedValue({ id: 1 });

      await configuredService.create(makeCreateUserDto());

      expect(bcrypt.hash).toHaveBeenCalledWith('plain-password', 12);
    });
  });

  describe('update', () => {
    const existingUser = { id: 1, email: 'john@example.com' };

    it('should hash the password when present', async () => {
      mockUserRepository.findOneBy.mockResolvedValue(existingUser);
      mockUserRepository.update.mockResolvedValue({ affected: 1 });

      await service.update(1, { password: 'new-password' });

      expect(bcrypt.hash).toHaveBeenCalledWith('new-password', 10);
      expect(mockUserRepository.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ password: 'hashed-pw' }),
      );
    });

    it('should not hash when the password is absent', async () => {
      mockUserRepository.findOneBy.mockResolvedValue(existingUser);
      mockUserRepository.update.mockResolvedValue({ affected: 1 });

      await service.update(1, { firstname: 'Jane' });

      expect(bcrypt.hash).not.toHaveBeenCalled();
      expect(mockUserRepository.update).toHaveBeenCalledWith(1, {
        firstname: 'Jane',
      });
    });

    it('should throw NotFoundException for an unknown id', async () => {
      mockUserRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.update(99, { password: 'new-password' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockUserRepository.update).not.toHaveBeenCalled();
    });
  });
});
