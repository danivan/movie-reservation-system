import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { QueryFailedError } from 'typeorm';
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

  // Values a real INSERT/UPDATE would carry; they must never reach a client
  // or the log.
  const SECRET_EMAIL = 'secret@x.dev';
  const SECRET_HASH = '$2b$10$secret-hash-value';
  const DB_TEXT = 'connection refused at 10.0.0.5';

  // A TypeORM driver error as Postgres reports it, carrying the SQL
  // parameters (email + hash) like a real failed write.
  const queryFailed = (code: string, message: string) =>
    new QueryFailedError(
      'INSERT INTO "user" ...',
      [SECRET_EMAIL, SECRET_HASH],
      Object.assign(new Error(message), { code }),
    );

  const uniqueViolation = () =>
    queryFailed('23505', 'duplicate key value violates unique constraint');

  // Everything a log argument could expose: plain values, and for errors the
  // message, stack and own enumerable props (query, parameters, ...).
  const stringifyLogArg = (arg: unknown): string => {
    if (arg instanceof Error) {
      return [String(arg), arg.stack, JSON.stringify(arg)].join('\n');
    }
    return typeof arg === 'string' ? arg : String(JSON.stringify(arg));
  };

  let loggerErrorSpy: jest.SpyInstance;

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
    mockUserRepository.delete.mockResolvedValue({ affected: 1 });
    // Re-applied after resetAllMocks: silences the logger and records calls.
    loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    service = await buildService();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('constructor', () => {
    it.each([
      '9',
      '16',
      '1',
      '0',
      '-1',
      '4.5',
      'abc',
      '1e9',
      'Infinity',
      // Number() reads each of these as 10 or 12; only decimal digits pass.
      '1e1',
      ' 12',
      '12.0',
      '0x0c',
    ])('should fail to build when JWT_SALT_OR_ROUNDS is %p', async (value) => {
      setSaltRounds(value);

      await expect(buildService()).rejects.toThrow(/JWT_SALT_OR_ROUNDS/);
    });

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
    it('should look the user up by the given email and return it', async () => {
      const user = makeUser({ id: 3, email: 'jane@example.com' });
      mockUserRepository.findOneBy.mockResolvedValue(user);

      const result = await service.findOneByEmail('jane@example.com');

      expect(result).toEqual(user);
      expect(mockUserRepository.findOneBy).toHaveBeenCalledWith({
        email: 'jane@example.com',
      });
    });

    it('should return null when the user does not exist', async () => {
      mockUserRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.findOneByEmail('missing@example.com'),
      ).resolves.toBeNull();
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

    it('should throw ConflictException when the email already exists', async () => {
      mockUserRepository.save.mockRejectedValue(uniqueViolation());

      const result = service.create(makeCreateUserDto({ email: SECRET_EMAIL }));

      await expect(result).rejects.toBeInstanceOf(ConflictException);
      await expect(result).rejects.toMatchObject({
        message: 'Email already in use',
      });
    });

    it('should throw a generic InternalServerErrorException for other DB errors', async () => {
      mockUserRepository.save.mockRejectedValue(new Error(DB_TEXT));

      const result = service.create(makeCreateUserDto());

      await expect(result).rejects.toBeInstanceOf(InternalServerErrorException);
      await expect(result).rejects.toMatchObject({
        message: 'Failed to create user',
      });
    });

    // Rejections that are not Error instances, including a raw driver-style
    // object carrying the query and its parameters.
    const NON_ERRORS: unknown[] = [
      undefined,
      'str',
      { query: 'INSERT INTO "user" ...', parameters: [SECRET_EMAIL] },
    ];

    it.each(NON_ERRORS)(
      'should map a non-Error rejection %p to a generic InternalServerErrorException',
      async (thrown) => {
        mockUserRepository.save.mockRejectedValue(thrown);

        const result = service.create(makeCreateUserDto());

        await expect(result).rejects.toBeInstanceOf(
          InternalServerErrorException,
        );
        await expect(result).rejects.toMatchObject({
          message: 'Failed to create user',
        });
      },
    );

    it.each(NON_ERRORS)(
      'should log a non-Error rejection %p as "Non-Error thrown" without its contents',
      async (thrown) => {
        mockUserRepository.save.mockRejectedValue(thrown);

        await expect(
          service.create(makeCreateUserDto({ email: SECRET_EMAIL })),
        ).rejects.toBeInstanceOf(InternalServerErrorException);

        const logged = loggerErrorSpy.mock.calls
          .flat()
          .map(stringifyLogArg)
          .join('\n');
        expect(logged).toContain('Non-Error thrown');
        expect(logged).not.toContain(SECRET_EMAIL);
        expect(logged).not.toContain('INSERT');
      },
    );

    it('should throw a generic InternalServerErrorException when hashing fails', async () => {
      (bcrypt.hash as jest.Mock).mockRejectedValue(new Error(DB_TEXT));

      const result = service.create(makeCreateUserDto());

      await expect(result).rejects.toBeInstanceOf(InternalServerErrorException);
      await expect(result).rejects.toMatchObject({
        message: 'Failed to create user',
      });
      expect(mockUserRepository.save).not.toHaveBeenCalled();
    });

    it('should log unexpected errors without query parameters', async () => {
      mockUserRepository.save.mockRejectedValue(
        queryFailed('XX000', 'internal error'),
      );

      await expect(
        service.create(makeCreateUserDto({ email: SECRET_EMAIL })),
      ).rejects.toBeInstanceOf(InternalServerErrorException);

      expect(loggerErrorSpy).toHaveBeenCalled();
      const logged = loggerErrorSpy.mock.calls
        .flat()
        .map(stringifyLogArg)
        .join('\n');
      expect(logged).toContain('QueryFailedError');
      expect(logged).toContain('internal error');
      expect(logged).not.toContain('INSERT INTO');
      expect(logged).not.toContain(SECRET_EMAIL);
      expect(logged).not.toContain(SECRET_HASH);
    });

    it('should rethrow HttpExceptions unchanged', async () => {
      const err = new ConflictException('x');
      mockUserRepository.save.mockRejectedValue(err);

      await expect(service.create(makeCreateUserDto())).rejects.toBe(err);
    });

    it.each([
      {
        code: '23505',
        message: 'doublon',
        type: ConflictException,
        expected: 'Email already in use',
      },
      {
        code: '23503',
        message: 'duplicate key value violates unique constraint',
        type: InternalServerErrorException,
        expected: 'Failed to create user',
      },
    ])(
      'should map driver code $code with message $message to $expected',
      async ({ code, message, type, expected }) => {
        mockUserRepository.save.mockRejectedValue(queryFailed(code, message));

        const result = service.create(makeCreateUserDto());

        await expect(result).rejects.toBeInstanceOf(type);
        await expect(result).rejects.toMatchObject({ message: expected });
      },
    );
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

    it('should return the reloaded user', async () => {
      const updated = makeUser({ id: 1, firstname: 'Jane' });
      mockUserRepository.findOneBy
        .mockResolvedValueOnce(makeUser({ id: 1 }))
        .mockResolvedValueOnce(updated);

      await expect(service.update(1, { firstname: 'Jane' })).resolves.toEqual(
        updated,
      );
      expect(mockUserRepository.findOneBy).toHaveBeenCalledTimes(2);
      expect(mockUserRepository.findOneBy).toHaveBeenNthCalledWith(2, {
        id: 1,
      });
    });

    it.each<[string, UpdateUserDto]>([
      ['an empty dto', {}],
      ['a dto whose only key is undefined', { firstname: undefined }],
    ])(
      'should throw BadRequestException for %s without touching the DB',
      async (_label, dto) => {
        const result = service.update(1, dto);

        await expect(result).rejects.toBeInstanceOf(BadRequestException);
        await expect(result).rejects.toMatchObject({
          message: 'No fields to update',
        });
        expect(mockUserRepository.findOneBy).not.toHaveBeenCalled();
        expect(mockUserRepository.update).not.toHaveBeenCalled();
        expect(bcrypt.hash).not.toHaveBeenCalled();
      },
    );

    // Non-HTTP callers bypass UpdateUserDto's @MinLength(8), so the service
    // itself must refuse a present-but-empty password.
    it.each<UpdateUserDto>([
      { password: '' },
      { password: null as unknown as string },
      { firstname: 'Jane', password: '' },
      { firstname: 'Jane', password: null as unknown as string },
    ])(
      'should reject %p with BadRequestException before touching the DB',
      async (dto) => {
        const result = service.update(1, dto);

        await expect(result).rejects.toThrow(BadRequestException);
        await expect(result).rejects.toMatchObject({
          message: 'password must not be empty',
        });
        expect(mockUserRepository.findOneBy).not.toHaveBeenCalled();
        expect(bcrypt.hash).not.toHaveBeenCalled();
        expect(mockUserRepository.update).not.toHaveBeenCalled();
      },
    );

    it('should throw ConflictException when the new email is taken', async () => {
      mockUserRepository.update.mockRejectedValue(uniqueViolation());

      const result = service.update(1, { email: SECRET_EMAIL });

      await expect(result).rejects.toBeInstanceOf(ConflictException);
      await expect(result).rejects.toMatchObject({
        message: 'Email already in use',
      });
    });

    it('should throw a generic InternalServerErrorException for other DB errors', async () => {
      mockUserRepository.update.mockRejectedValue(new Error(DB_TEXT));

      const result = service.update(1, { firstname: 'Jane' });

      await expect(result).rejects.toBeInstanceOf(InternalServerErrorException);
      await expect(result).rejects.toMatchObject({
        message: 'Failed to update user',
      });
    });

    it('should throw a generic InternalServerErrorException for a non-unique QueryFailedError', async () => {
      mockUserRepository.update.mockRejectedValue(
        queryFailed('XX000', 'internal error'),
      );

      const result = service.update(1, { firstname: 'Jane' });

      await expect(result).rejects.toBeInstanceOf(InternalServerErrorException);
      await expect(result).rejects.toMatchObject({
        message: 'Failed to update user',
      });
    });

    it('should throw a generic InternalServerErrorException when hashing fails', async () => {
      (bcrypt.hash as jest.Mock).mockRejectedValue(new Error(DB_TEXT));

      const result = service.update(1, { password: 'new-password' });

      await expect(result).rejects.toBeInstanceOf(InternalServerErrorException);
      await expect(result).rejects.toMatchObject({
        message: 'Failed to update user',
      });
      expect(mockUserRepository.update).not.toHaveBeenCalled();
    });

    it('should rethrow HttpExceptions unchanged', async () => {
      const err = new ConflictException('x');
      mockUserRepository.update.mockRejectedValue(err);

      await expect(service.update(1, { firstname: 'Jane' })).rejects.toBe(err);
    });

    it('should accept a dto whose only field is falsy but defined', async () => {
      await expect(service.update(1, { isAdmin: false })).resolves.toEqual(
        makeUser(),
      );

      expect(mockUserRepository.update).toHaveBeenCalledWith(1, {
        isAdmin: false,
      });
    });
  });

  describe('remove', () => {
    it('should delete an existing user', async () => {
      mockUserRepository.findOneBy.mockResolvedValue(makeUser({ id: 2 }));

      await expect(service.remove(2)).resolves.toBeUndefined();

      expect(mockUserRepository.findOneBy).toHaveBeenCalledWith({ id: 2 });
      expect(mockUserRepository.delete).toHaveBeenCalledWith(2);
    });

    it('should throw NotFoundException for an unknown id', async () => {
      mockUserRepository.findOneBy.mockResolvedValue(null);

      await expect(service.remove(99)).rejects.toThrow(NotFoundException);
      expect(mockUserRepository.delete).not.toHaveBeenCalled();
    });

    it('should throw a generic InternalServerErrorException when delete fails', async () => {
      mockUserRepository.delete.mockRejectedValue(new Error(DB_TEXT));

      const result = service.remove(2);

      await expect(result).rejects.toBeInstanceOf(InternalServerErrorException);
      await expect(result).rejects.toMatchObject({
        message: 'Failed to remove user',
      });
    });
  });
});
