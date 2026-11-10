import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UserService } from './user.service';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

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

  const makeUser = (overrides: Partial<User> = {}): User => ({
    id: 1,
    email: 'john@example.com',
    password: 'stored-hash',
    firstname: 'John',
    lastname: 'Doe',
    isAdmin: false,
    ...overrides,
  });

  // Makes the config mock return `value` for JWT_SALT_OR_ROUNDS; any other
  // key falls back to the default passed to get(key, default).
  const setSaltRounds = (value: string) => {
    mockConfigService.get.mockImplementation((key: string, def?: unknown) =>
      key === 'JWT_SALT_OR_ROUNDS' ? value : def,
    );
  };

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
    // resetAllMocks (not clearAllMocks) so no implementation or *Once queue
    // leaks from one test into the next; every default is re-stubbed below.
    jest.resetAllMocks();
    // Output depends on the input, so a double hash or a wrong rounds value
    // produces a different string than the one asserted.
    (bcrypt.hash as jest.Mock).mockImplementation(
      async (plain: string, rounds: number) => `hashed(${plain},${rounds})`,
    );
    // No JWT_SALT_OR_ROUNDS configured by default, so the fallback (10) applies.
    mockConfigService.get.mockImplementation(
      (_key: string, def?: unknown) => def,
    );
    // Pass-through so whatever the service hands to create() reaches save().
    mockUserRepository.create.mockImplementation((data) => ({ ...data }));
    mockUserRepository.save.mockImplementation(async (entity) => ({
      id: 1,
      ...entity,
    }));
    mockUserRepository.findOneBy.mockResolvedValue(makeUser());
    mockUserRepository.update.mockResolvedValue({ affected: 1 });

    service = await buildService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('constructor', () => {
    it.each(['9', '16', '1', '0', '-1', '4.5', 'abc', '1e9', 'Infinity'])(
      'should fail to build when JWT_SALT_OR_ROUNDS is %p',
      async (value) => {
        setSaltRounds(value);

        await expect(buildService()).rejects.toThrow(/JWT_SALT_OR_ROUNDS/);
      },
    );

    it.each([
      ['10', 10],
      ['12', 12],
      ['15', 15],
    ])(
      'should build with JWT_SALT_OR_ROUNDS %p and hash with %p rounds on create',
      async (value, rounds) => {
        setSaltRounds(value);
        const configuredService = await buildService();

        await configuredService.create(makeCreateUserDto());

        expect(bcrypt.hash).toHaveBeenCalledWith('plain-password', rounds);
      },
    );

    it('should default to 10 rounds when JWT_SALT_OR_ROUNDS is unset', async () => {
      await service.create(makeCreateUserDto());

      expect(bcrypt.hash).toHaveBeenCalledWith('plain-password', 10);
    });

    it('should default to 10 rounds when JWT_SALT_OR_ROUNDS is empty', async () => {
      setSaltRounds('');
      const configuredService = await buildService();

      await configuredService.create(makeCreateUserDto());

      expect(bcrypt.hash).toHaveBeenCalledWith('plain-password', 10);
    });

    it('should read JWT_SALT_OR_ROUNDS once at construction', async () => {
      setSaltRounds('12');
      const configuredService = await buildService();
      setSaltRounds('14');

      await configuredService.create(makeCreateUserDto());

      expect(bcrypt.hash).toHaveBeenCalledWith('plain-password', 12);
      expect(mockUserRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ password: 'hashed(plain-password,12)' }),
      );
    });
  });

  describe('findOne', () => {
    it('should return the user when found', async () => {
      const user = makeUser({ id: 1, email: 'test@example.com' });
      mockUserRepository.findOneBy.mockResolvedValue(user);

      await expect(service.findOne(1)).resolves.toEqual(user);
      expect(mockUserRepository.findOneBy).toHaveBeenCalledWith({ id: 1 });
    });

    it('should throw NotFoundException when the user does not exist', async () => {
      mockUserRepository.findOneBy.mockResolvedValue(null);

      await expect(service.findOne(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findOneByEmail', () => {
    it('should return the user when found', async () => {
      const user = makeUser({ id: 3, email: 'jane@example.com' });
      mockUserRepository.findOneBy.mockResolvedValue(user);

      const result = await service.findOneByEmail('jane@example.com');

      expect(result).toEqual(user);
    });

    it('should return null when the user does not exist', async () => {
      mockUserRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.findOneByEmail('missing@example.com'),
      ).resolves.toBeNull();
    });

    it('should look the user up by the given email', async () => {
      await service.findOneByEmail('jane@example.com');

      expect(mockUserRepository.findOneBy).toHaveBeenCalledWith({
        email: 'jane@example.com',
      });
    });
  });

  describe('create', () => {
    it('should return the saved user', async () => {
      const saved = makeUser({ id: 7 });
      mockUserRepository.save.mockResolvedValue(saved);

      await expect(service.create(makeCreateUserDto())).resolves.toEqual(saved);
    });

    it('should hash the password before saving', async () => {
      await service.create(makeCreateUserDto());

      expect(bcrypt.hash).toHaveBeenCalledWith('plain-password', 10);
      expect(mockUserRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'john@example.com',
          password: 'hashed(plain-password,10)',
        }),
      );
      expect(mockUserRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ password: 'plain-password' }),
      );
    });

    it("should not mutate the caller's DTO", async () => {
      const dto = Object.freeze(makeCreateUserDto());

      await service.create(dto);

      expect(dto.password).toBe('plain-password');
    });
  });

  describe('update', () => {
    it('should hash the password when present', async () => {
      await service.update(1, { password: 'new-password' });

      expect(bcrypt.hash).toHaveBeenCalledWith('new-password', 10);
      expect(mockUserRepository.update).toHaveBeenCalledWith(1, {
        password: 'hashed(new-password,10)',
      });
    });

    it('should use JWT_SALT_OR_ROUNDS when hashing on update', async () => {
      setSaltRounds('12');
      const configuredService = await buildService();

      await configuredService.update(1, { password: 'new-password' });

      expect(bcrypt.hash).toHaveBeenCalledWith('new-password', 12);
      expect(mockUserRepository.update).toHaveBeenCalledWith(1, {
        password: 'hashed(new-password,12)',
      });
    });

    it('should not hash when the password is absent', async () => {
      await service.update(1, { firstname: 'Jane' });

      expect(bcrypt.hash).not.toHaveBeenCalled();
      expect(mockUserRepository.update).toHaveBeenCalledWith(1, {
        firstname: 'Jane',
      });
    });

    it("should not mutate the caller's DTO", async () => {
      const dto: UpdateUserDto = Object.freeze({ password: 'new-password' });

      await service.update(1, dto);

      expect(dto.password).toBe('new-password');
    });

    it('should throw NotFoundException for an unknown id', async () => {
      mockUserRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.update(99, { password: 'new-password' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockUserRepository.update).not.toHaveBeenCalled();
      expect(bcrypt.hash).not.toHaveBeenCalled();
    });
  });
});
