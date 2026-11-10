import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  const mockConfigService = {
    getOrThrow: jest.fn(),
  };

  beforeEach(async () => {
    // resetAllMocks (not clearAllMocks) so no implementation leaks between
    // tests; the default is re-stubbed below.
    jest.resetAllMocks();
    mockConfigService.getOrThrow.mockReturnValue('test-secret');
    jest.spyOn(console, 'log').mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should read JWT_SECRET with getOrThrow', () => {
      expect(mockConfigService.getOrThrow).toHaveBeenCalledWith('JWT_SECRET');
    });
  });

  describe('validate', () => {
    const payload = {
      email: 'a@x.dev',
      sub: 7,
      isAdmin: true,
      iat: 1,
      exp: 2,
    };

    it('should map the JWT payload to the request user', async () => {
      const user = await strategy.validate(payload);

      expect(user).toStrictEqual({
        id: 7,
        username: 'a@x.dev',
        isAdmin: true,
      });
    });

    it('should not log the payload', async () => {
      await strategy.validate(payload);

      expect(console.log).not.toHaveBeenCalled();
    });
  });
});
