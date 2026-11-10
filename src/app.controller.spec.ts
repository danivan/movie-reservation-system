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
    it('should sign up a user with the request body', async () => {
      const body = {
        firstname: 'John',
        lastname: 'Doe',
        email: 'john@example.com',
        password: 'secret',
      };
      const created = { id: 1, ...body };
      mockAuthService.signUp.mockResolvedValue(created);

      const result = await appController.register({ body });

      expect(mockAuthService.signUp).toHaveBeenCalledWith(body);
      expect(result).toEqual(created);
    });
  });
});
