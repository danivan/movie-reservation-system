import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Genre } from 'src/types';
import { validationPipeOptions } from 'src/validation-pipe.options';
import { CreateMovieDto } from './create-movie.dto';

const makeCreateMovieBody = (overrides: Record<string, unknown> = {}) => ({
  title: 'Arrival',
  description: 'A linguist works with the military to talk to aliens.',
  durationMinutes: 116,
  genre: Genre.SCI_FI,
  releaseDate: '2016-11-11',
  ...overrides,
});

const validateBody = async (body: Record<string, unknown>) =>
  validate(plainToInstance(CreateMovieDto, body));

const invalidProperties = async (overrides: Record<string, unknown>) => {
  const errors = await validateBody(makeCreateMovieBody(overrides));
  return errors.map((error) => error.property);
};

// 'https://example.com/' is 20 characters long.
const httpsUrlOfLength = (length: number) =>
  `https://example.com/${'a'.repeat(length - 20)}`;

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

describe('CreateMovieDto', () => {
  describe('valid input', () => {
    it('should accept a fully valid body without posterUrl', async () => {
      const errors = await validateBody(makeCreateMovieBody());

      expect(errors).toEqual([]);
    });

    it('should accept a fully valid body with an https posterUrl', async () => {
      const errors = await validateBody(
        makeCreateMovieBody({ posterUrl: 'https://example.com/arrival.jpg' }),
      );

      expect(errors).toEqual([]);
    });
  });

  describe('title', () => {
    it('should reject a missing title', async () => {
      expect(await invalidProperties({ title: undefined })).toContain('title');
    });

    it('should reject a null title', async () => {
      expect(await invalidProperties({ title: null })).toContain('title');
    });

    it('should reject a non-string title', async () => {
      expect(await invalidProperties({ title: 123 })).toContain('title');
    });

    it('should reject an empty title', async () => {
      expect(await invalidProperties({ title: '' })).toContain('title');
    });

    it('should reject a whitespace-only title', async () => {
      expect(await invalidProperties({ title: '   ' })).toContain('title');
    });

    it('should accept a title of exactly 200 characters', async () => {
      const errors = await validateBody(
        makeCreateMovieBody({ title: 'x'.repeat(200) }),
      );

      expect(errors).toEqual([]);
    });

    it('should reject a title of 201 characters', async () => {
      expect(await invalidProperties({ title: 'x'.repeat(201) })).toContain(
        'title',
      );
    });

    it('should accept a 200-character title padded with whitespace, since it is trimmed before the length check', async () => {
      const errors = await validateBody(
        makeCreateMovieBody({ title: `  ${'x'.repeat(200)} ` }),
      );

      expect(errors).toEqual([]);
    });

    it('should trim surrounding whitespace from the title', () => {
      const dto = plainToInstance(
        CreateMovieDto,
        makeCreateMovieBody({ title: '  Arrival ' }),
      );

      expect(dto.title).toBe('Arrival');
    });

    it('should reject a title containing a NUL byte', async () => {
      expect(await invalidProperties({ title: 'a\u0000b' })).toContain('title');
    });
  });

  describe('description', () => {
    it('should reject a missing description', async () => {
      expect(await invalidProperties({ description: undefined })).toContain(
        'description',
      );
    });

    it('should reject a null description', async () => {
      expect(await invalidProperties({ description: null })).toContain(
        'description',
      );
    });

    it('should reject a non-string description', async () => {
      expect(await invalidProperties({ description: 123 })).toContain(
        'description',
      );
    });

    it('should reject an empty description', async () => {
      expect(await invalidProperties({ description: '' })).toContain(
        'description',
      );
    });

    it('should reject a whitespace-only description', async () => {
      expect(await invalidProperties({ description: '   ' })).toContain(
        'description',
      );
    });

    it('should accept a description of exactly 5000 characters', async () => {
      const errors = await validateBody(
        makeCreateMovieBody({ description: 'x'.repeat(5000) }),
      );

      expect(errors).toEqual([]);
    });

    it('should reject a description of 5001 characters', async () => {
      expect(
        await invalidProperties({ description: 'x'.repeat(5001) }),
      ).toContain('description');
    });

    it('should accept a 5000-character description padded with whitespace, since it is trimmed before the length check', async () => {
      const errors = await validateBody(
        makeCreateMovieBody({ description: ` ${'x'.repeat(5000)}  ` }),
      );

      expect(errors).toEqual([]);
    });

    it('should trim surrounding whitespace from the description', () => {
      const dto = plainToInstance(
        CreateMovieDto,
        makeCreateMovieBody({ description: '  First contact. ' }),
      );

      expect(dto.description).toBe('First contact.');
    });

    it('should reject a description containing a NUL byte', async () => {
      expect(await invalidProperties({ description: 'a\u0000b' })).toContain(
        'description',
      );
    });
  });

  describe('durationMinutes', () => {
    it('should accept a duration of 1 minute', async () => {
      const errors = await validateBody(
        makeCreateMovieBody({ durationMinutes: 1 }),
      );

      expect(errors).toEqual([]);
    });

    it('should accept a duration of 600 minutes', async () => {
      const errors = await validateBody(
        makeCreateMovieBody({ durationMinutes: 600 }),
      );

      expect(errors).toEqual([]);
    });

    it('should reject a duration of 0 minutes', async () => {
      expect(await invalidProperties({ durationMinutes: 0 })).toContain(
        'durationMinutes',
      );
    });

    it('should reject a negative duration', async () => {
      expect(await invalidProperties({ durationMinutes: -1 })).toContain(
        'durationMinutes',
      );
    });

    it('should reject a duration of 601 minutes', async () => {
      expect(await invalidProperties({ durationMinutes: 601 })).toContain(
        'durationMinutes',
      );
    });

    it('should reject a non-integer duration of 90.5', async () => {
      expect(await invalidProperties({ durationMinutes: 90.5 })).toContain(
        'durationMinutes',
      );
    });

    it("should reject the string '120' without converting it", async () => {
      expect(await invalidProperties({ durationMinutes: '120' })).toContain(
        'durationMinutes',
      );
    });

    it('should reject a missing duration', async () => {
      expect(await invalidProperties({ durationMinutes: undefined })).toContain(
        'durationMinutes',
      );
    });

    it('should reject a null duration', async () => {
      expect(await invalidProperties({ durationMinutes: null })).toContain(
        'durationMinutes',
      );
    });
  });

  describe('genre', () => {
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
      const errors = await validateBody(makeCreateMovieBody({ genre }));

      expect(errors).toEqual([]);
    });

    it("should reject the wrongly-cased genre 'Action'", async () => {
      expect(await invalidProperties({ genre: 'Action' })).toContain('genre');
    });

    it('should reject an unknown genre', async () => {
      expect(await invalidProperties({ genre: 'nope' })).toContain('genre');
    });

    it('should reject a missing genre', async () => {
      expect(await invalidProperties({ genre: undefined })).toContain('genre');
    });

    it('should reject a null genre', async () => {
      expect(await invalidProperties({ genre: null })).toContain('genre');
    });
  });

  describe('releaseDate', () => {
    it.each(['2021-01-01', '2024-02-29', '1800-01-01', '2199-12-31'])(
      'should accept the date %s',
      async (releaseDate) => {
        const errors = await validateBody(makeCreateMovieBody({ releaseDate }));

        expect(errors).toEqual([]);
      },
    );

    it('should reject 2021-02-29, which does not exist', async () => {
      expect(await invalidProperties({ releaseDate: '2021-02-29' })).toContain(
        'releaseDate',
      );
    });

    it('should reject 0000-01-01', async () => {
      expect(await invalidProperties({ releaseDate: '0000-01-01' })).toContain(
        'releaseDate',
      );
    });

    it('should reject a year before 1800', async () => {
      expect(await invalidProperties({ releaseDate: '1799-12-31' })).toContain(
        'releaseDate',
      );
    });

    it('should reject a year after 2199', async () => {
      expect(await invalidProperties({ releaseDate: '2200-01-01' })).toContain(
        'releaseDate',
      );
    });

    it('should reject a datetime', async () => {
      expect(
        await invalidProperties({ releaseDate: '2021-01-01T00:00:00Z' }),
      ).toContain('releaseDate');
    });

    it('should reject a month of 13', async () => {
      expect(await invalidProperties({ releaseDate: '2021-13-01' })).toContain(
        'releaseDate',
      );
    });

    it('should reject a non-string releaseDate', async () => {
      expect(await invalidProperties({ releaseDate: 20210101 })).toContain(
        'releaseDate',
      );
    });

    it('should reject a missing releaseDate', async () => {
      expect(await invalidProperties({ releaseDate: undefined })).toContain(
        'releaseDate',
      );
    });

    it('should reject a null releaseDate', async () => {
      expect(await invalidProperties({ releaseDate: null })).toContain(
        'releaseDate',
      );
    });
  });

  describe('posterUrl', () => {
    it('should accept an omitted posterUrl', async () => {
      const errors = await validateBody(
        makeCreateMovieBody({ posterUrl: undefined }),
      );

      expect(errors).toEqual([]);
    });

    it('should accept a null posterUrl', async () => {
      const errors = await validateBody(
        makeCreateMovieBody({ posterUrl: null }),
      );

      expect(errors).toEqual([]);
    });

    it('should accept an https posterUrl of exactly 2048 characters', async () => {
      const errors = await validateBody(
        makeCreateMovieBody({ posterUrl: httpsUrlOfLength(2048) }),
      );

      expect(errors).toEqual([]);
    });

    it('should reject an https posterUrl of 2049 characters', async () => {
      expect(
        await invalidProperties({ posterUrl: httpsUrlOfLength(2049) }),
      ).toContain('posterUrl');
    });

    it('should reject an http posterUrl', async () => {
      expect(
        await invalidProperties({ posterUrl: 'http://example.com/a.jpg' }),
      ).toContain('posterUrl');
    });

    it('should reject a posterUrl without a protocol', async () => {
      expect(
        await invalidProperties({ posterUrl: 'example.com/a.jpg' }),
      ).toContain('posterUrl');
    });

    it('should reject a javascript: posterUrl', async () => {
      expect(
        await invalidProperties({ posterUrl: 'javascript:alert(1)' }),
      ).toContain('posterUrl');
    });

    it('should reject an empty posterUrl', async () => {
      expect(await invalidProperties({ posterUrl: '' })).toContain('posterUrl');
    });

    it('should reject a non-string posterUrl', async () => {
      expect(await invalidProperties({ posterUrl: 123 })).toContain(
        'posterUrl',
      );
    });
  });

  describe('with the global ValidationPipe', () => {
    let pipe: ValidationPipe;

    const transformBody = (body: Record<string, unknown>) =>
      pipe.transform(body, { type: 'body', metatype: CreateMovieDto });

    beforeEach(() => {
      pipe = new ValidationPipe(validationPipeOptions);
    });

    it('should reject a body containing id with BadRequestException', async () => {
      const messages = await rejectionMessages(
        transformBody(makeCreateMovieBody({ id: 1 })),
      );

      expect(messages).toContain('property id should not exist');
    });

    it('should reject a body with an unknown field with BadRequestException', async () => {
      const messages = await rejectionMessages(
        transformBody(makeCreateMovieBody({ rating: 5 })),
      );

      expect(messages).toContain('property rating should not exist');
    });

    it('should resolve a valid body to a CreateMovieDto with a trimmed title', async () => {
      const result = await transformBody(
        makeCreateMovieBody({ title: '  Arrival ' }),
      );

      expect(result).toBeInstanceOf(CreateMovieDto);
      expect(result.title).toBe('Arrival');
    });
  });
});
