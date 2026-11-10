import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { RegisterDto } from './auth/dto/register.dto';
import { UpdateUserDto } from './user/dto/update-user.dto';
import { validationPipeOptions } from './validation-pipe.options';

const makeRegisterBody = (overrides: Record<string, unknown> = {}) => ({
  firstname: 'Jane',
  lastname: 'Doe',
  email: 'jane@example.com',
  password: 'password123',
  ...overrides,
});

describe('validationPipeOptions', () => {
  let pipe: ValidationPipe;

  const transformBody = (body: Record<string, unknown>) =>
    pipe.transform(body, { type: 'body', metatype: RegisterDto });

  beforeEach(() => {
    pipe = new ValidationPipe(validationPipeOptions);
  });

  describe('transform', () => {
    it('should reject a register body containing isAdmin with BadRequestException', async () => {
      const body = makeRegisterBody({ isAdmin: true });

      await expect(transformBody(body)).rejects.toThrow(BadRequestException);
    });

    it('should reject a register body with an unknown field with BadRequestException', async () => {
      const body = makeRegisterBody({ role: 'admin' });

      await expect(transformBody(body)).rejects.toThrow(BadRequestException);
    });

    it('should resolve a valid body to a RegisterDto instance', async () => {
      const body = makeRegisterBody({ email: 'Foo@Bar.DEV' });

      const result = await transformBody(body);

      expect(result).toBeInstanceOf(RegisterDto);
    });

    it('should lowercase the email of a valid register body', async () => {
      const body = makeRegisterBody({ email: 'Foo@Bar.DEV' });

      const result = await transformBody(body);

      expect(result.email).toBe('foo@bar.dev');
    });

    it('should reject an UpdateUserDto body with a null firstname with BadRequestException', async () => {
      await expect(
        pipe.transform(
          { firstname: null },
          { type: 'body', metatype: UpdateUserDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should not add isAdmin to an UpdateUserDto body with only a password', async () => {
      const result = await pipe.transform(
        { password: 'x'.repeat(8) },
        { type: 'body', metatype: UpdateUserDto },
      );

      expect(result).not.toHaveProperty('isAdmin');
    });
  });
});
