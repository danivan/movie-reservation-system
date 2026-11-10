import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AuthService } from './auth/auth.service';
import { RegisterDto } from './auth/dto/register.dto';

describe('AppController', () => {
  let appController: AppController;
  const mockAuthService = {
    login: jest.fn(),
    signUp: jest.fn(),
  };

  beforeEach(async () => {
    // resetAllMocks so no implementation or *Once queue leaks between tests;
    // each test stubs the service calls it relies on.
    jest.resetAllMocks();

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
      expect(mockAuthService.signUp.mock.calls[0][0]).toBe(dto);
      expect(result).toEqual(created);
    });

    it('should type the register body parameter as RegisterDto', () => {
      const paramTypes = Reflect.getMetadata(
        'design:paramtypes',
        AppController.prototype,
        'register',
      );

      expect(paramTypes[0]).toBe(RegisterDto);
    });
  });
});
