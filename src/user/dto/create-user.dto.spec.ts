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

    it('should explain that the firstname must not contain NUL characters', async () => {
      const errors = await validateBody(
        makeCreateUserBody({ firstname: 'a\u0000b' }),
      );
      const messages = errors
        .filter((error) => error.property === 'firstname')
        .flatMap((error) => Object.values(error.constraints ?? {}));

      expect(messages).toContain('firstname must not contain NUL characters');
    });

    it('should trim surrounding whitespace from the firstname', () => {
      const dto = plainToInstance(
        CreateUserDto,
        makeCreateUserBody({ firstname: '  Jane  ' }),
      );

      expect(dto.firstname).toBe('Jane');
    });

    it('should accept a firstname that is valid once trimmed', async () => {
      const errors = await validateBody(
        makeCreateUserBody({ firstname: '  Jane  ' }),
      );

      expect(errors).toEqual([]);
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

    it('should reject a non-string lastname', async () => {
      expect(await invalidProperties({ lastname: 123 })).toContain('lastname');
    });

    it('should reject a whitespace-only lastname', async () => {
      expect(await invalidProperties({ lastname: '   ' })).toContain(
        'lastname',
      );
    });

    it('should reject a lastname containing a NUL byte', async () => {
      expect(await invalidProperties({ lastname: 'a\u0000b' })).toContain(
        'lastname',
      );
    });

    it('should trim surrounding whitespace from the lastname', () => {
      const dto = plainToInstance(
        CreateUserDto,
        makeCreateUserBody({ lastname: '  Doe  ' }),
      );

      expect(dto.lastname).toBe('Doe');
    });

    it('should accept a lastname that is valid once trimmed', async () => {
      const errors = await validateBody(
        makeCreateUserBody({ lastname: '  Doe  ' }),
      );

      expect(errors).toEqual([]);
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

    // Postgres rejects U+0000 in text (G21); @IsEmail already rules it out.
    it('should reject an email containing a NUL byte', async () => {
      expect(await invalidProperties({ email: 'a\u0000@x.dev' })).toContain(
        'email',
      );
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

    // Native bcrypt stops at the first NUL, so an all-NUL password hashes
    // like an empty one.
    it('should reject a password made only of NUL bytes', async () => {
      expect(
        await invalidProperties({ password: '\u0000'.repeat(8) }),
      ).toContain('password');
    });

    it('should reject a password containing a NUL byte', async () => {
      expect(await invalidProperties({ password: 'abc\u0000defgh' })).toContain(
        'password',
      );
    });

    it('should explain that the password must not contain NUL characters', async () => {
      const errors = await validateBody(
        makeCreateUserBody({ password: 'abc\u0000defgh' }),
      );
      const messages = errors
        .filter((error) => error.property === 'password')
        .flatMap((error) => Object.values(error.constraints ?? {}));

      expect(messages).toContain('password must not contain NUL characters');
    });
  });

  describe('isAdmin', () => {
    it('should reject a non-boolean isAdmin', async () => {
      expect(await invalidProperties({ isAdmin: 'yes' })).toContain('isAdmin');
    });

    it('should reject the string "true" without converting it', async () => {
      expect(await invalidProperties({ isAdmin: 'true' })).toContain('isAdmin');
    });

    it('should reject isAdmin set to null', async () => {
      expect(await invalidProperties({ isAdmin: null })).toContain('isAdmin');
    });

    it('should accept isAdmin explicitly undefined', async () => {
      const errors = await validateBody(
        makeCreateUserBody({ isAdmin: undefined }),
      );

      expect(errors).toEqual([]);
    });
  });
});
