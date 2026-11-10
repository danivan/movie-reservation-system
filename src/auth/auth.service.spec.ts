import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { ConflictException } from '@nestjs/common';
import { UserService } from 'src/user/user.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User } from 'src/user/entities/user.entity';

jest.mock('bcrypt');

describe('AuthService', () => {
  let module: TestingModule;
  let service: AuthService;
  const mockUserService = {
    findOneByEmail: jest.fn(),
    create: jest.fn(),
    hashPassword: jest.fn(),
  };

  const mockJwtService = {
    sign: jest.fn(),
  };

  const makeUser = (overrides: Partial<User> = {}): User => ({
    id: 1,
    email: 'test@example.com',
    password: 'stored-hash',
    firstname: 'Test',
    lastname: 'User',
    isAdmin: false,
    ...overrides,
  });

  // The random plaintext AuthService handed to hashPassword on its nth call.
  const dummyPlain = (n = 0): string =>
    mockUserService.hashPassword.mock.calls[n][0];

  // Lets already-settled promise handlers (e.g. a swallowed rejection) run.
  const flushPromises = () => new Promise((r) => setImmediate(r));

  const NON_STRINGS: unknown[] = [123, true, null, undefined, {}, ['a']];

  beforeEach(async () => {
    // resetAllMocks (not clearAllMocks) so no implementation or *Once queue
    // leaks from one test into the next; every default is re-stubbed below.
    jest.resetAllMocks();
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-pw');
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    mockUserService.findOneByEmail.mockResolvedValue(null);
    mockUserService.create.mockResolvedValue({ id: 1 });
    // Output depends on the input, so comparing against anything other than
    // the hash of the plaintext AuthService generated is caught.
    mockUserService.hashPassword.mockImplementation(
      async (plain: string) => `hashed:${plain}`,
    );
    mockJwtService.sign.mockReturnValue('signed-token');

    // compile() only: lifecycle hooks (onModuleInit) do not run unless a test
    // calls module.init() explicitly.
    module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserService, useValue: mockUserService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateUser', () => {
    it('should return the user without password for valid credentials', async () => {
      mockUserService.findOneByEmail.mockResolvedValueOnce(makeUser());
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);

      const user = await service.validateUser(
        'test@example.com',
        'plain-password',
      );

      expect(user).toEqual({
        id: 1,
        email: 'test@example.com',
        firstname: 'Test',
        lastname: 'User',
        isAdmin: false,
      });
      expect(user).not.toHaveProperty('password');
      expect(mockUserService.findOneByEmail).toHaveBeenCalledWith(
        'test@example.com',
      );
      expect(bcrypt.compare).toHaveBeenCalledWith(
        'plain-password',
        'stored-hash',
      );
    });

    it('should return null for a wrong password', async () => {
      mockUserService.findOneByEmail.mockResolvedValueOnce(makeUser());
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

      const user = await service.validateUser(
        'test@example.com',
        'wrong-password',
      );

      expect(user).toBeNull();
    });

    it('should return null when no user is found', async () => {
      mockUserService.findOneByEmail.mockResolvedValueOnce(null);

      const user = await service.validateUser(
        'missing@example.com',
        'plain-password',
      );

      expect(user).toBeNull();
      // Equalises timing with the wrong-password path (G7).
      const plain = dummyPlain();
      expect(plain).toMatch(/^[0-9a-f]{32}$/);
      expect(bcrypt.compare).toHaveBeenCalledWith(
        'plain-password',
        `hashed:${plain}`,
      );
    });

    it('should return null for an unknown email even if compare resolves true', async () => {
      mockUserService.findOneByEmail.mockResolvedValueOnce(null);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);

      await expect(
        service.validateUser('missing@example.com', 'plain-password'),
      ).resolves.toBeNull();
    });

    it('should compute the dummy hash only once', async () => {
      await service.validateUser('missing-1@example.com', 'first-password');
      await service.validateUser('missing-2@example.com', 'second-password');

      expect(mockUserService.hashPassword).toHaveBeenCalledTimes(1);
      const plain = dummyPlain();
      expect(plain).toMatch(/^[0-9a-f]{32}$/);
      expect(bcrypt.compare).toHaveBeenCalledWith(
        'first-password',
        `hashed:${plain}`,
      );
      expect(bcrypt.compare).toHaveBeenCalledWith(
        'second-password',
        `hashed:${plain}`,
      );
    });

    it('should compute the dummy hash once under concurrent unknown-email logins', async () => {
      await Promise.all([
        service.validateUser('a@x.dev', 'p1'),
        service.validateUser('b@x.dev', 'p2'),
      ]);

      expect(mockUserService.hashPassword).toHaveBeenCalledTimes(1);
      const plain = dummyPlain();
      expect(bcrypt.compare).toHaveBeenCalledWith('p1', `hashed:${plain}`);
      expect(bcrypt.compare).toHaveBeenCalledWith('p2', `hashed:${plain}`);
    });

    it('should retry the dummy hash after hashPassword rejects', async () => {
      mockUserService.hashPassword.mockRejectedValueOnce(new Error('boom'));

      await expect(
        service.validateUser('missing-1@example.com', 'first-password'),
      ).rejects.toThrow('boom');
      await expect(
        service.validateUser('missing-2@example.com', 'second-password'),
      ).resolves.toBeNull();

      expect(mockUserService.hashPassword).toHaveBeenCalledTimes(2);
      const plain = dummyPlain(1);
      expect(plain).toMatch(/^[0-9a-f]{32}$/);
      expect(bcrypt.compare).toHaveBeenCalledWith(
        'second-password',
        `hashed:${plain}`,
      );
    });

    it('should not compute a dummy hash for a known user', async () => {
      // Plain compile(), no init: the lazy path must not hash for known users.
      // Wrong password: the non-matching path must not fall through to the
      // dummy-hash work either.
      mockUserService.findOneByEmail.mockResolvedValueOnce(makeUser());
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

      await service.validateUser('test@example.com', 'wrong-password');

      expect(mockUserService.hashPassword).not.toHaveBeenCalled();
      expect(bcrypt.compare).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.stringMatching(/^hashed:/),
      );
    });

    it('should normalise the email before lookup', async () => {
      await service.validateUser('  Foo@Bar.DEV ', 'pw');

      expect(mockUserService.findOneByEmail).toHaveBeenCalledWith(
        'foo@bar.dev',
      );
    });

    it.each(NON_STRINGS)(
      'should return null for a non-string email %p without looking anything up',
      async (email) => {
        await expect(
          service.validateUser(email as any, 'plain-password'),
        ).resolves.toBeNull();

        expect(mockUserService.findOneByEmail).not.toHaveBeenCalled();
        expect(bcrypt.compare).not.toHaveBeenCalled();
        expect(mockUserService.hashPassword).not.toHaveBeenCalled();
      },
    );

    it('should return null for an email containing a NUL byte without looking anything up', async () => {
      await expect(
        service.validateUser('a\u0000@x.dev', 'plain-password'),
      ).resolves.toBeNull();

      expect(mockUserService.findOneByEmail).not.toHaveBeenCalled();
      expect(bcrypt.compare).not.toHaveBeenCalled();
      expect(mockUserService.hashPassword).not.toHaveBeenCalled();
    });

    it.each(NON_STRINGS)(
      'should return null for a non-string password %p without looking anything up',
      async (pass) => {
        await expect(
          service.validateUser('test@example.com', pass as any),
        ).resolves.toBeNull();

        expect(mockUserService.findOneByEmail).not.toHaveBeenCalled();
        expect(bcrypt.compare).not.toHaveBeenCalled();
        expect(mockUserService.hashPassword).not.toHaveBeenCalled();
      },
    );
  });

  describe('onModuleInit', () => {
    it('should start computing the dummy hash at startup', async () => {
      await module.init();

      expect(mockUserService.hashPassword).toHaveBeenCalledTimes(1);
      expect(dummyPlain()).toMatch(/^[0-9a-f]{32}$/);
    });

    it('should reuse the startup hash for unknown-email logins', async () => {
      await module.init();

      await service.validateUser('missing-1@example.com', 'first-password');
      await service.validateUser('missing-2@example.com', 'second-password');

      expect(mockUserService.hashPassword).toHaveBeenCalledTimes(1);
      const plain = dummyPlain();
      expect(bcrypt.compare).toHaveBeenCalledWith(
        'first-password',
        `hashed:${plain}`,
      );
      expect(bcrypt.compare).toHaveBeenCalledWith(
        'second-password',
        `hashed:${plain}`,
      );
    });

    it('should not throw or reject at startup if hashPassword rejects', async () => {
      mockUserService.hashPassword.mockRejectedValueOnce(new Error('boom'));

      await expect(module.init()).resolves.toBe(module);
      await flushPromises();

      await expect(
        service.validateUser('missing@example.com', 'plain-password'),
      ).resolves.toBeNull();
      expect(mockUserService.hashPassword).toHaveBeenCalledTimes(2);
      expect(bcrypt.compare).toHaveBeenCalledWith(
        'plain-password',
        `hashed:${dummyPlain(1)}`,
      );
    });
  });

  describe('signUp', () => {
    it('should pass the plaintext password to usersService.create', async () => {
      await service.signUp({
        email: 'jane@example.com',
        password: 'plain-password',
        firstname: 'Jane',
        lastname: 'Doe',
      });

      expect(mockUserService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'jane@example.com',
          password: 'plain-password',
        }),
      );
    });

    it('should not hash the password itself', async () => {
      await service.signUp({
        email: 'jane@example.com',
        password: 'plain-password',
        firstname: 'Jane',
        lastname: 'Doe',
      });

      expect(bcrypt.hash).not.toHaveBeenCalled();
    });

    it('should create the user with isAdmin false when input sets isAdmin true', async () => {
      // Loosely typed on purpose: RegisterDto has no isAdmin, but a caller
      // bypassing validation must still not be able to self-promote.
      const input: any = {
        email: 'eve@example.com',
        password: 'password123',
        firstname: 'Eve',
        lastname: 'Attacker',
        isAdmin: true,
      };

      await service.signUp(input);

      expect(mockUserService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'eve@example.com',
          firstname: 'Eve',
          lastname: 'Attacker',
          isAdmin: false,
        }),
      );
    });

    it('should create the user with isAdmin false when input omits isAdmin', async () => {
      const input: any = {
        email: 'jane@example.com',
        password: 'password123',
        firstname: 'Jane',
        lastname: 'Doe',
      };

      await service.signUp(input);

      expect(mockUserService.create).toHaveBeenCalledWith(
        expect.objectContaining({ isAdmin: false }),
      );
    });

    it('should propagate ConflictException from usersService.create unchanged', async () => {
      const err = new ConflictException('Email already in use');
      mockUserService.create.mockRejectedValueOnce(err);

      await expect(
        service.signUp({
          email: 'taken@example.com',
          password: 'plain-password',
          firstname: 'Jane',
          lastname: 'Doe',
        }),
      ).rejects.toBe(err);
    });

    it('should propagate other errors unchanged', async () => {
      const err = new Error('boom');
      mockUserService.create.mockRejectedValueOnce(err);

      await expect(
        service.signUp({
          email: 'jane@example.com',
          password: 'plain-password',
          firstname: 'Jane',
          lastname: 'Doe',
        }),
      ).rejects.toBe(err);
    });
  });
});
