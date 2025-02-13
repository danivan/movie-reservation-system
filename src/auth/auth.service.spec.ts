import { AuthService } from './auth.service';
import { InternalServerErrorException } from '@nestjs/common';
import { UserService } from 'src/user/user.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { User } from 'src/user/entities/user.entity';

describe('AuthService', () => {
  let service: AuthService;
  const mockUserService = {
    findOneByEmail: jest.fn(),
    create: jest.fn(),
  } as unknown as UserService;

  const mockJwtService = {
    sign: jest.fn(),
  } as unknown as JwtService;

  const mockConfigService = {
    get: jest.fn(),
  } as unknown as ConfigService;

  beforeEach(async () => {
    service = new AuthService(
      mockUserService,
      mockJwtService,
      mockConfigService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateUser', () => {
    it('should return a user for a valid user', async () => {
      const result: User = {
        id: 1,
        email: 'test',
        password: 'test',
        firstname: 'test',
        lastname: 'test',
        isAdmin: false,
      };

      mockUserService.findOneByEmail = jest.fn().mockResolvedValueOnce(result);

      const bcryptCompare = jest.fn().mockResolvedValue(true);
      (bcrypt.compare as jest.Mock) = bcryptCompare;

      const user = await service.validateUser('test', 'test');

      const { password, ...expected } = result;
      expect(user).toEqual(expected);
    });

    it('should not return a user for an invalid user', async () => {
      mockUserService.findOneByEmail = jest.fn().mockResolvedValueOnce(null);
      const user = await service.validateUser('test', 'test1');
      expect(user).toBeNull();
    });
  });

  describe('signUp', () => {
    it('should return a user for a valid user', async () => {
      const createUserData = {
        email: 'test',
        password: 'test',
        firstname: 'test',
        lastname: 'test',
        isAdmin: false,
      };
      const result = {
        id: 1,
        email: 'test',
        password: 'test',
      };
      mockUserService.create = jest.fn().mockImplementation(async (data) => ({
        id: 1,
        email: data.email,
        password: expect.any(String),
      }));

      const user = await service.signUp(createUserData);
      expect(user).toEqual(result);
    });

    it('should throw an error for an invalid user', async () => {
      mockUserService.create = jest
        .fn()
        .mockRejectedValue(new Error('Failed to create user'));

      await expect(
        service.signUp({
          email: '',
          password: '',
          firstname: '',
          lastname: '',
          isAdmin: false,
        }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
