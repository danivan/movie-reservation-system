import { AuthService } from './auth.service';
import { InternalServerErrorException } from '@nestjs/common';
import { UserService } from 'src/user/user.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { User } from 'src/user/entities/user.entity';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  const mockUserService = {
    findOneByEmail: jest.fn(),
    create: jest.fn(),
  };

  const mockJwtService = {
    sign: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
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

  beforeEach(() => {
    jest.clearAllMocks();
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-pw');
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    mockConfigService.get.mockReturnValue(undefined);
    mockUserService.create.mockResolvedValue({ id: 1 });

    service = new AuthService(
      mockUserService as unknown as UserService,
      mockJwtService as unknown as JwtService,
      mockConfigService as unknown as ConfigService,
    );
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
