import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateUserDto } from './update-user.dto';

const invalidProperties = async (body: Record<string, unknown>) => {
  const errors = await validate(plainToInstance(UpdateUserDto, body));
  return errors.map((error) => error.property);
};

describe('UpdateUserDto', () => {
  describe('isAdmin', () => {
    it('should not add an isAdmin key when only password is given', () => {
      const dto = plainToInstance(UpdateUserDto, { password: 'x'.repeat(8) });

      expect(dto).not.toHaveProperty('isAdmin');
    });

    it('should keep isAdmin true when it is given', () => {
      const dto = plainToInstance(UpdateUserDto, { isAdmin: true });

      expect(dto.isAdmin).toBe(true);
    });

    it('should accept isAdmin true with no validation errors', async () => {
      const errors = await validate(
        plainToInstance(UpdateUserDto, { isAdmin: true }),
      );

      expect(errors).toEqual([]);
    });
  });

  describe('optional fields', () => {
    it('should accept an empty object', async () => {
      const errors = await validate(plainToInstance(UpdateUserDto, {}));

      expect(errors).toEqual([]);
    });

    it('should accept a body with only a valid password', async () => {
      const errors = await validate(
        plainToInstance(UpdateUserDto, { password: 'x'.repeat(8) }),
      );

      expect(errors).toEqual([]);
    });

    it('should accept a field explicitly set to undefined', async () => {
      const errors = await validate(
        plainToInstance(UpdateUserDto, { firstname: undefined }),
      );

      expect(errors).toEqual([]);
    });
  });

  describe('explicit null', () => {
    it.each(['firstname', 'lastname', 'email', 'password', 'isAdmin'])(
      'should reject %s set to null',
      async (field) => {
        expect(await invalidProperties({ [field]: null })).toContain(field);
      },
    );
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

    it('should trim and lowercase the email', () => {
      const dto = plainToInstance(UpdateUserDto, { email: '  Foo@Bar.DEV ' });

      expect(dto.email).toBe('foo@bar.dev');
    });

    it('should reject a lastname containing a NUL byte', async () => {
      expect(await invalidProperties({ lastname: 'a\u0000b' })).toContain(
        'lastname',
      );
    });

    it('should reject a password made only of NUL bytes', async () => {
      expect(
        await invalidProperties({ password: '\u0000'.repeat(8) }),
      ).toContain('password');
    });

    it('should reject a whitespace-only lastname', async () => {
      expect(await invalidProperties({ lastname: '   ' })).toContain(
        'lastname',
      );
    });
  });
});
