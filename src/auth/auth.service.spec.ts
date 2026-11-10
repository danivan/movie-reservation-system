import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { InternalServerErrorException } from '@nestjs/common';
import { UserService } from 'src/user/user.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User } from 'src/user/entities/user.entity';

jest.mock('bcrypt');

describe('AuthService', () => {
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

  beforeEach(async () => {
    // resetAllMocks (not clearAllMocks) so no implementation or *Once queue
    // leaks from one test into the next; every default is re-stubbed below.
    jest.resetAllMocks();
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-pw');
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    mockUserService.findOneByEmail.mockResolvedValue(null);
    mockUserService.create.mockResolvedValue({ id: 1 });
    mockUserService.hashPassword.mockResolvedValue('dummy-hash');
    mockJwtService.sign.mockReturnValue('signed-token');

    const module: TestingModule = await Test.createTestingModule({
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
      expect(bcrypt.compare).toHaveBeenCalledWith(
        'plain-password',
        'dummy-hash',
      );
    });

    it('should compute the dummy hash only once', async () => {
      mockUserService.findOneByEmail.mockResolvedValue(null);

      await service.validateUser('missing-1@example.com', 'first-password');
      await service.validateUser('missing-2@example.com', 'second-password');

      expect(mockUserService.hashPassword).toHaveBeenCalledTimes(1);
      expect(mockUserService.hashPassword).toHaveBeenCalledWith(
        expect.any(String),
      );
      expect(bcrypt.compare).toHaveBeenCalledWith(
        'first-password',
        'dummy-hash',
      );
      expect(bcrypt.compare).toHaveBeenCalledWith(
        'second-password',
        'dummy-hash',
      );
    });

    it('should not compute a dummy hash for a known user', async () => {
      // Wrong password: the non-matching path must not fall through to the
      // dummy-hash work either.
      mockUserService.findOneByEmail.mockResolvedValueOnce(makeUser());
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

      await service.validateUser('test@example.com', 'wrong-password');

      expect(mockUserService.hashPassword).not.toHaveBeenCalled();
      expect(bcrypt.compare).not.toHaveBeenCalledWith(
        expect.anything(),
        'dummy-hash',
      );
    });

    it('should normalise the email before lookup', async () => {
      await service.validateUser('  Foo@Bar.DEV ', 'pw');

      expect(mockUserService.findOneByEmail).toHaveBeenCalledWith(
        'foo@bar.dev',
      );
    });

    it('should return null without throwing when findOneByEmail returns null', async () => {
      mockUserService.findOneByEmail.mockResolvedValueOnce(null);

      await expect(
        service.validateUser('missing@example.com', 'plain-password'),
      ).resolves.toBeNull();
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

    it('should throw an error for an invalid user', async () => {
      mockUserService.create.mockRejectedValueOnce(
        new Error('Failed to create user'),
      );

      await expect(
        service.signUp({
          email: '',
          password: '',
          firstname: '',
          lastname: '',
        }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
