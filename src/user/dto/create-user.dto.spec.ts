import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

const makeCreateUserBody = (overrides: Record<string, unknown> = {}) => ({
  firstname: 'Jane',
  lastname: 'Doe',
  email: 'jane@example.com',
  password: 'password123',
  ...overrides,
});

const validateBody = async (body: Record<string, unknown>) =>
  validate(plainToInstance(CreateUserDto, body));

const invalidProperties = async (overrides: Record<string, unknown>) => {
  const errors = await validateBody(makeCreateUserBody(overrides));
  return errors.map((error) => error.property);
};

describe('CreateUserDto', () => {
  describe('valid input', () => {
    it('should accept a fully valid body without isAdmin', async () => {
      const errors = await validateBody(makeCreateUserBody());

      expect(errors).toEqual([]);
    });

    it('should accept isAdmin set to true', async () => {
      const errors = await validateBody(makeCreateUserBody({ isAdmin: true }));

      expect(errors).toEqual([]);
    });

    it('should accept isAdmin set to false', async () => {
      const errors = await validateBody(makeCreateUserBody({ isAdmin: false }));

      expect(errors).toEqual([]);
    });
  });

  describe('firstname', () => {
    it('should reject an empty firstname', async () => {
      expect(await invalidProperties({ firstname: '' })).toContain('firstname');
    });

    it('should reject a missing firstname', async () => {
      expect(await invalidProperties({ firstname: undefined })).toContain(
        'firstname',
      );
    });

    it('should reject a non-string firstname', async () => {
      expect(await invalidProperties({ firstname: 123 })).toContain(
        'firstname',
      );
    });
  });

  describe('lastname', () => {
    it('should reject an empty lastname', async () => {
      expect(await invalidProperties({ lastname: '' })).toContain('lastname');
    });

    it('should reject a missing lastname', async () => {
      expect(await invalidProperties({ lastname: undefined })).toContain(
        'lastname',
      );
    });
  });

  describe('email', () => {
    it('should reject a malformed email', async () => {
      expect(await invalidProperties({ email: 'not-an-email' })).toContain(
        'email',
      );
    });

    it('should reject an empty email', async () => {
      expect(await invalidProperties({ email: '' })).toContain('email');
    });

    it('should reject a missing email', async () => {
      expect(await invalidProperties({ email: undefined })).toContain('email');
    });

    it('should reject a non-string email without throwing', async () => {
      expect(await invalidProperties({ email: 123 })).toContain('email');
    });

    it('should trim and lowercase the email', () => {
      const dto = plainToInstance(
        CreateUserDto,
        makeCreateUserBody({ email: '  Foo@Bar.DEV ' }),
      );

      expect(dto.email).toBe('foo@bar.dev');
    });

    it('should accept an email that is valid once trimmed', async () => {
      const errors = await validateBody(
        makeCreateUserBody({ email: '  Foo@Bar.DEV ' }),
      );

      expect(errors).toEqual([]);
    });
  });

  describe('password', () => {
    it('should reject a password of 7 characters', async () => {
      expect(await invalidProperties({ password: 'x'.repeat(7) })).toContain(
        'password',
      );
    });

    it('should accept a password of exactly 8 characters', async () => {
      const errors = await validateBody(
        makeCreateUserBody({ password: 'x'.repeat(8) }),
      );

      expect(errors).toEqual([]);
    });

    it('should accept a password of exactly 72 characters', async () => {
      const errors = await validateBody(
        makeCreateUserBody({ password: 'x'.repeat(72) }),
      );

      expect(errors).toEqual([]);
    });

    it('should reject a password of 73 characters', async () => {
      expect(await invalidProperties({ password: 'x'.repeat(73) })).toContain(
        'password',
      );
    });

    it('should reject a missing password', async () => {
      expect(await invalidProperties({ password: undefined })).toContain(
        'password',
      );
    });

    it('should reject a non-string password', async () => {
      expect(await invalidProperties({ password: 12345678 })).toContain(
        'password',
      );
    });
  });

  describe('isAdmin', () => {
    it('should reject a non-boolean isAdmin', async () => {
      expect(await invalidProperties({ isAdmin: 'yes' })).toContain('isAdmin');
    });
  });
});
