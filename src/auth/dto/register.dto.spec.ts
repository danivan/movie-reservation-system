import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto';

const strict = { whitelist: true, forbidNonWhitelisted: true };

const makeRegisterBody = (overrides: Record<string, unknown> = {}) => ({
  firstname: 'Jane',
  lastname: 'Doe',
  email: 'jane@example.com',
  password: 'password123',
  ...overrides,
});

const validateStrict = async (body: Record<string, unknown>) =>
  validate(plainToInstance(RegisterDto, body), strict);

const invalidProperties = async (overrides: Record<string, unknown>) => {
  const errors = await validateStrict(makeRegisterBody(overrides));
  return errors.map((error) => error.property);
};

describe('RegisterDto', () => {
  describe('valid input', () => {
    it('should accept a valid body without isAdmin', async () => {
      const errors = await validateStrict(makeRegisterBody());

      expect(errors).toEqual([]);
    });
  });

  describe('isAdmin', () => {
    it('should reject isAdmin true as non-whitelisted', async () => {
      expect(await invalidProperties({ isAdmin: true })).toContain('isAdmin');
    });

    it('should reject isAdmin false as non-whitelisted', async () => {
      expect(await invalidProperties({ isAdmin: false })).toContain('isAdmin');
    });
  });

  describe('inherited CreateUserDto rules', () => {
    it('should reject a malformed email', async () => {
      expect(await invalidProperties({ email: 'not-an-email' })).toContain(
        'email',
      );
    });

    it('should reject a password shorter than 8 characters', async () => {
      expect(await invalidProperties({ password: 'x'.repeat(7) })).toContain(
        'password',
      );
    });

    it('should reject a password longer than 72 characters', async () => {
      expect(await invalidProperties({ password: 'x'.repeat(73) })).toContain(
        'password',
      );
    });

    it('should reject an empty firstname', async () => {
      expect(await invalidProperties({ firstname: '' })).toContain('firstname');
    });

    it('should reject a whitespace-only firstname', async () => {
      expect(await invalidProperties({ firstname: '   ' })).toContain(
        'firstname',
      );
    });

    it('should reject a firstname containing a NUL byte', async () => {
      expect(await invalidProperties({ firstname: 'a\u0000b' })).toContain(
        'firstname',
      );
    });

    it('should trim and lowercase the email', () => {
      const dto = plainToInstance(
        RegisterDto,
        makeRegisterBody({ email: '  Foo@Bar.DEV ' }),
      );

      expect(dto.email).toBe('foo@bar.dev');
    });
  });
});
