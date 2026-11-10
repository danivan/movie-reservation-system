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
  });
});
