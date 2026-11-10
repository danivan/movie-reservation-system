import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AuthService } from './auth/auth.service';

describe('AppController', () => {
  let appController: AppController;
  const mockAuthService = {
    login: jest.fn(),
    signUp: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('login', () => {
    it('should return an access token for the authenticated user', async () => {
      const user = { id: 1, email: 'test@example.com' };
      const token = { access_token: 'token' };
      mockAuthService.login.mockResolvedValue(token);

      const result = await appController.login({ user });

      expect(mockAuthService.login).toHaveBeenCalledWith(user);
      expect(result).toEqual(token);
    });
  });

  describe('register', () => {
    it('should pass the register DTO itself to signUp', async () => {
      const dto = {
        firstname: 'John',
        lastname: 'Doe',
        email: 'john@example.com',
        password: 'password123',
      };
      const created = { id: 1, ...dto, isAdmin: false };
      mockAuthService.signUp.mockResolvedValue(created);

      const result = await appController.register(dto);

      expect(mockAuthService.signUp).toHaveBeenCalledWith(dto);
      expect(result).toEqual(created);
    });
  });
});
