import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { validationPipeOptions } from 'src/validation-pipe.options';
import { UpdateMovieDto } from './update-movie.dto';

const validateBody = async (body: Record<string, unknown>) =>
  validate(plainToInstance(UpdateMovieDto, body));

const invalidProperties = async (body: Record<string, unknown>) => {
  const errors = await validateBody(body);
  return errors.map((error) => error.property);
};

const rejectionMessages = async (promise: Promise<unknown>) => {
  const error: unknown = await promise.then(
    () => undefined,
    (rejection: unknown) => rejection,
  );
  expect(error).toBeInstanceOf(BadRequestException);
  const response = (error as BadRequestException).getResponse() as {
    message: string[];
  };
  return response.message;
};

describe('UpdateMovieDto', () => {
  describe('partial bodies', () => {
    it('should transform { title } into an object whose only key is title', () => {
      const dto = plainToInstance(UpdateMovieDto, { title: 'x' });

      expect(Object.keys(dto)).toEqual(['title']);
    });

    it('should accept an empty object, leaving the empty check to the service', async () => {
      const errors = await validateBody({});

      expect(errors).toEqual([]);
    });

    it('should accept a body with only a valid title', async () => {
      const errors = await validateBody({ title: 'x' });

      expect(errors).toEqual([]);
    });

    it('should accept a field explicitly set to undefined', async () => {
      const errors = await validateBody({ genre: undefined });

      expect(errors).toEqual([]);
    });
  });

  describe('explicit null', () => {
    it.each([
      'title',
      'description',
      'durationMinutes',
      'genre',
      'releaseDate',
    ])('should reject %s set to null', async (field) => {
      expect(await invalidProperties({ [field]: null })).toContain(field);
    });

    it('should accept posterUrl set to null', async () => {
      const errors = await validateBody({ posterUrl: null });

      expect(errors).toEqual([]);
    });

    it('should keep posterUrl as null so the poster can be cleared', () => {
      const dto = plainToInstance(UpdateMovieDto, { posterUrl: null });

      expect(dto.posterUrl).toBeNull();
    });
  });

  describe('inherited CreateMovieDto rules', () => {
    it('should reject an unknown genre', async () => {
      expect(await invalidProperties({ genre: 'nope' })).toContain('genre');
    });

    it('should reject a whitespace-only title', async () => {
      expect(await invalidProperties({ title: '   ' })).toContain('title');
    });

    it('should reject a title of 201 characters', async () => {
      expect(await invalidProperties({ title: 'x'.repeat(201) })).toContain(
        'title',
      );
    });

    it('should reject a description containing a NUL byte', async () => {
      expect(await invalidProperties({ description: 'a\u0000b' })).toContain(
        'description',
      );
    });

    it('should reject a duration of 0 minutes', async () => {
      expect(await invalidProperties({ durationMinutes: 0 })).toContain(
        'durationMinutes',
      );
    });

    it("should reject the string '120' as a duration", async () => {
      expect(await invalidProperties({ durationMinutes: '120' })).toContain(
        'durationMinutes',
      );
    });

    it('should reject 2021-02-29 as a releaseDate', async () => {
      expect(await invalidProperties({ releaseDate: '2021-02-29' })).toContain(
        'releaseDate',
      );
    });

    it('should reject an http posterUrl', async () => {
      expect(
        await invalidProperties({ posterUrl: 'http://example.com/a.jpg' }),
      ).toContain('posterUrl');
    });

    it('should trim surrounding whitespace from the title', () => {
      const dto = plainToInstance(UpdateMovieDto, { title: '  Arrival ' });

      expect(dto.title).toBe('Arrival');
    });
  });

  describe('with the global ValidationPipe', () => {
    let pipe: ValidationPipe;

    const transformBody = (body: Record<string, unknown>) =>
      pipe.transform(body, { type: 'body', metatype: UpdateMovieDto });

    beforeEach(() => {
      pipe = new ValidationPipe(validationPipeOptions);
    });

    it('should reject a body containing id with BadRequestException', async () => {
      const messages = await rejectionMessages(
        transformBody({ id: 1, title: 'x' }),
      );

      expect(messages).toContain('property id should not exist');
    });

    it('should reject a null title with BadRequestException', async () => {
      await expect(transformBody({ title: null })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should resolve { title } to an object whose only key is title', async () => {
      const result = await transformBody({ title: 'x' });

      expect(Object.keys(result)).toEqual(['title']);
    });
  });
});
