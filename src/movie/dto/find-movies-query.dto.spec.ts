import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { validationPipeOptions } from 'src/validation-pipe.options';
import { FindMoviesQueryDto } from './find-movies-query.dto';

const validateQuery = async (query: Record<string, unknown>) =>
  validate(plainToInstance(FindMoviesQueryDto, query));

const invalidProperties = async (query: Record<string, unknown>) => {
  const errors = await validateQuery(query);
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

describe('FindMoviesQueryDto', () => {
  describe('genre', () => {
    it('should accept an empty query', async () => {
      const errors = await validateQuery({});

      expect(errors).toEqual([]);
    });

    it.each([
      'action',
      'animation',
      'comedy',
      'documentary',
      'drama',
      'horror',
      'romance',
      'sci-fi',
      'thriller',
    ])('should accept the genre %s', async (genre) => {
      const errors = await validateQuery({ genre });

      expect(errors).toEqual([]);
    });

    it("should reject the unknown genre 'nope'", async () => {
      expect(await invalidProperties({ genre: 'nope' })).toContain('genre');
    });

    it("should reject the wrongly-cased genre 'Drama'", async () => {
      expect(await invalidProperties({ genre: 'Drama' })).toContain('genre');
    });
  });

  describe('with the global ValidationPipe', () => {
    let pipe: ValidationPipe;

    const transformQuery = (query: Record<string, unknown>) =>
      pipe.transform(query, { type: 'query', metatype: FindMoviesQueryDto });

    const isGenreMessage = expect.stringMatching(/^genre /);

    beforeEach(() => {
      pipe = new ValidationPipe(validationPipeOptions);
    });

    it('should resolve an empty query without a genre', async () => {
      const result = await transformQuery({});

      expect(result.genre).toBeUndefined();
    });

    it("should resolve ?genre=drama to genre 'drama'", async () => {
      const result = await transformQuery({ genre: 'drama' });

      expect(result.genre).toBe('drama');
    });

    it('should reject ?genre=nope with BadRequestException', async () => {
      const messages = await rejectionMessages(
        transformQuery({ genre: 'nope' }),
      );

      expect(messages).toEqual(expect.arrayContaining([isGenreMessage]));
    });

    it('should reject an empty ?genre= with BadRequestException', async () => {
      const messages = await rejectionMessages(transformQuery({ genre: '' }));

      expect(messages).toEqual(expect.arrayContaining([isGenreMessage]));
    });

    it('should reject a repeated ?genre=drama&genre=comedy with BadRequestException', async () => {
      const messages = await rejectionMessages(
        transformQuery({ genre: ['drama', 'comedy'] }),
      );

      expect(messages).toEqual(expect.arrayContaining([isGenreMessage]));
    });

    it('should reject an unknown query key with BadRequestException', async () => {
      const messages = await rejectionMessages(transformQuery({ foo: '1' }));

      expect(messages).toContain('property foo should not exist');
    });
  });
});
