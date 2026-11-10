import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { spyOnAllLogging } from '../../test/utils/spy-on-logging';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let logging: ReturnType<typeof spyOnAllLogging>;
  const mockConfigService = {
    getOrThrow: jest.fn(),
  };

  beforeEach(async () => {
    // resetAllMocks (not clearAllMocks) so no implementation leaks between
    // tests; the default is re-stubbed below.
    jest.resetAllMocks();
    mockConfigService.getOrThrow.mockReturnValue('test-secret');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
    // Spy after compile so only validate() is inside the spy window.
    logging = spyOnAllLogging();
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

    it('should map a non-admin payload with isAdmin false', async () => {
      const user = await strategy.validate({
        email: 'b@x.dev',
        sub: 8,
        isAdmin: false,
        iat: 1,
        exp: 2,
      });

      expect(user).toStrictEqual({
        id: 8,
        username: 'b@x.dev',
        isAdmin: false,
      });
    });

    it('should not log the payload on any console or Nest Logger channel', async () => {
      await strategy.validate(payload);

      logging.expectNoLogging();
    });
  });
});
