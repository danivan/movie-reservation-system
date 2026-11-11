import { Test, TestingModule } from '@nestjs/testing';
import { getStorageToken, ThrottlerStorageService } from '@nestjs/throttler';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { randomBytes } from 'crypto';
import { DataSource, ILike } from 'typeorm';
import { AppModule } from 'src/app.module';
import { User } from 'src/user/entities/user.entity';
import { Movie } from 'src/movie/entities/movie.entity';
import { Genre } from 'src/types';
import { spyOnAllLogging } from './utils/spy-on-logging';

// Every user and movie created by this suite gets this prefix (on the email
// or the title), so afterAll removes exactly the rows this run created. It
// differs from the auth suite's `e2e-<ts>-`, so neither cleanup touches the
// other's rows.
const RUN_PREFIX = `e2e-movie-${Date.now()}-`;
// Fresh per run (24 hex chars, within the 8-72 limit), so leftover accounts
// from a killed run never have guessable credentials.
const PASSWORD = randomBytes(12).toString('hex');
const ADMIN_PASSWORD = randomBytes(12).toString('hex');
let emailSeq = 0;
const uniqueEmail = () => `${RUN_PREFIX}${emailSeq++}@test.dev`;
let titleSeq = 0;
const uniqueTitle = () => `${RUN_PREFIX}movie-${titleSeq++}`;

const NUMERIC_ID_MESSAGE = 'Validation failed (numeric string is expected)';
const ID_RANGE_MESSAGE =
  'Validation failed (id must be between 1 and 2147483647)';
// G17: each is rejected by @IdParam() with the given message.
const BAD_IDS: [string, string][] = [
  ['abc', NUMERIC_ID_MESSAGE],
  ['0x10', NUMERIC_ID_MESSAGE],
  ['1e3', NUMERIC_ID_MESSAGE],
  ['0', ID_RANGE_MESSAGE],
  // One past the Postgres `integer` max.
  ['2147483648', ID_RANGE_MESSAGE],
];
const RELEASE_DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const POSTER_URL = 'https://example.com/poster.jpg';

// Genre member names aren't part of the Interface, so use the values.
const genre = (value: string) => value as Genre;

const notFoundMessage = (id: number) => `Movie with ID ${id} not found`;

type MovieBody = { id: number; title: string; genre: string };

describe('Movie (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;

  const server = () => app.getHttpServer();
  const users = () => dataSource.getRepository(User);
  const movies = () => dataSource.getRepository(Movie);

  const register = (body: Record<string, unknown>) =>
    request(server()).post('/auth/register').send(body);

  const login = (username: string, password: string) =>
    request(server()).post('/auth/login').send({ username, password });

  const authed = (req: request.Test, token: string) =>
    req.set('Authorization', `Bearer ${token}`);

  // Registers a fresh non-admin user and returns its DB row.
  const seedUser = async ({
    email = uniqueEmail(),
    password = PASSWORD,
  }: { email?: string; password?: string } = {}): Promise<User> => {
    await register({
      firstname: 'Sam',
      lastname: 'Seeded',
      email,
      password,
    }).expect(201);
    return users().findOneByOrFail({ email });
  };

  // Registers a fresh non-admin user, logs it in and returns its token.
  const seedUserToken = async (): Promise<string> => {
    const user = await seedUser();
    const res = await login(user.email, PASSWORD).expect(201);
    return res.body.access_token;
  };

  // Inserts a movie directly and returns it as re-read from the DB.
  const seedMovie = async (overrides: Partial<Movie> = {}): Promise<Movie> => {
    const saved = await movies().save(
      movies().create({
        title: uniqueTitle(),
        description: 'A seeded movie.',
        durationMinutes: 120,
        genre: genre('drama'),
        releaseDate: '2010-07-16',
        posterUrl: null,
        ...overrides,
      }),
    );
    return movies().findOneByOrFail({ id: saved.id });
  };

  // An id this run created and then deleted, so it is known not to exist
  // without touching rows the suite didn't create.
  const deletedMovieId = async (): Promise<number> => {
    const movie = await seedMovie();
    await movies().delete({ id: movie.id });
    return movie.id;
  };

  const countRunMovies = () =>
    movies().countBy({ title: ILike(`%${RUN_PREFIX}%`) });

  const makeMovieBody = (overrides: Record<string, unknown> = {}) => ({
    title: uniqueTitle(),
    description: 'A linguist is recruited to talk to alien visitors.',
    durationMinutes: 116,
    genre: 'sci-fi',
    releaseDate: '2016-11-11',
    ...overrides,
  });

  const createMovie = (body: Record<string, unknown>) =>
    authed(request(server()).post('/movie').send(body), adminToken);

  const patchMovie = (id: number | string, body: Record<string, unknown>) =>
    authed(request(server()).patch(`/movie/${id}`).send(body), adminToken);

  const deleteMovie = (id: number | string) =>
    authed(request(server()).delete(`/movie/${id}`), adminToken);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    dataSource = app.get(DataSource);

    // Register can't grant admin, so promote the seeded user directly in the
    // DB (G9).
    const admin = await seedUser({ password: ADMIN_PASSWORD });
    await users().update({ id: admin.id }, { isAdmin: true });

    const res = await login(admin.email, ADMIN_PASSWORD).expect(201);
    adminToken = res.body.access_token;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // Infix match, so a title stored untrimmed is still removed.
      await movies().delete({ title: ILike(`%${RUN_PREFIX}%`) });
      await users().delete({ email: ILike(`${RUN_PREFIX}%`) });
    }
    await app?.close();
  });

  describe('GET /movie', () => {
    it('should list movies without a token with 200', async () => {
      const seeded = await seedMovie();

      const res = await request(server()).get('/movie').expect(200);

      expect(res.body).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: seeded.id })]),
      );
    });

    it('should return releaseDate as exactly YYYY-MM-DD and a null posterUrl when none was set', async () => {
      const seeded = await seedMovie({ releaseDate: '1999-03-31' });

      const res = await request(server()).get('/movie').expect(200);

      const row = res.body.find((m: MovieBody) => m.id === seeded.id);
      expect(row.releaseDate).toBe('1999-03-31');
      expect(row.posterUrl).toBeNull();
    });

    it('should include only movies of the requested genre', async () => {
      const horror = await seedMovie({ genre: genre('horror') });
      const comedy = await seedMovie({ genre: genre('comedy') });

      const res = await request(server())
        .get('/movie')
        .query({ genre: 'horror' })
        .expect(200);

      const runIds = res.body
        .filter((m: MovieBody) => m.title.includes(RUN_PREFIX))
        .map((m: MovieBody) => m.id);
      expect(runIds).toContain(horror.id);
      expect(runIds).not.toContain(comedy.id);
      const genres = res.body.map((m: MovieBody) => m.genre);
      expect(genres.every((g: string) => g === 'horror')).toBe(true);
    });

    it('should order movies by title ascending', async () => {
      // Seeded in reverse, so id order alone would put B first.
      const b = await seedMovie({ title: `${RUN_PREFIX}B` });
      const a = await seedMovie({ title: `${RUN_PREFIX}A` });

      const res = await request(server()).get('/movie').expect(200);

      const runIds = res.body
        .filter((m: MovieBody) => m.title.includes(RUN_PREFIX))
        .map((m: MovieBody) => m.id);
      expect(runIds).toContain(a.id);
      expect(runIds).toContain(b.id);
      expect(runIds.indexOf(a.id)).toBeLessThan(runIds.indexOf(b.id));
    });

    it('should order movies with the same title by id ascending', async () => {
      const title = `${RUN_PREFIX}Same title`;
      const first = await seedMovie({ title });
      const second = await seedMovie({ title });

      const res = await request(server()).get('/movie').expect(200);

      const runIds = res.body
        .filter((m: MovieBody) => m.title.includes(RUN_PREFIX))
        .map((m: MovieBody) => m.id);
      expect(runIds).toContain(first.id);
      expect(runIds).toContain(second.id);
      expect(runIds.indexOf(first.id)).toBeLessThan(runIds.indexOf(second.id));
    });

    it('should reject an unknown genre with 400', async () => {
      const res = await request(server())
        .get('/movie')
        .query({ genre: 'nope' })
        .expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('genre')]),
      );
    });

    it('should reject a repeated genre with 400', async () => {
      const res = await request(server())
        .get('/movie?genre=horror&genre=comedy')
        .expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('genre')]),
      );
    });

    it('should reject an empty genre with 400', async () => {
      const res = await request(server()).get('/movie?genre=').expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('genre')]),
      );
    });

    it('should reject an unknown query key with 400', async () => {
      const res = await request(server()).get('/movie?foo=1').expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining(['property foo should not exist']),
      );
    });
  });

  describe('GET /movie/:id', () => {
    it('should return the movie without a token with 200', async () => {
      const seeded = await seedMovie({
        title: `${RUN_PREFIX}Inception`,
        description: 'A thief steals secrets through dreams.',
        durationMinutes: 148,
        genre: genre('sci-fi'),
        releaseDate: '2010-07-16',
      });

      const res = await request(server())
        .get(`/movie/${seeded.id}`)
        .expect(200);

      expect(res.body).toEqual({
        id: seeded.id,
        title: `${RUN_PREFIX}Inception`,
        description: 'A thief steals secrets through dreams.',
        durationMinutes: 148,
        genre: 'sci-fi',
        releaseDate: '2010-07-16',
        posterUrl: null,
      });
    });

    it('should return releaseDate as exactly YYYY-MM-DD', async () => {
      const seeded = await seedMovie({ releaseDate: '2001-01-02' });

      const res = await request(server())
        .get(`/movie/${seeded.id}`)
        .expect(200);

      expect(res.body.releaseDate).toMatch(RELEASE_DATE_FORMAT);
      expect(res.body.releaseDate).toBe('2001-01-02');
    });

    it('should return 404 with the not-found message for a deleted id', async () => {
      const id = await deletedMovieId();

      const res = await request(server()).get(`/movie/${id}`).expect(404);

      expect(res.body.message).toBe(notFoundMessage(id));
    });

    it.each(BAD_IDS)(
      'should return 400 for the invalid id %p',
      async (id, message) => {
        const res = await request(server()).get(`/movie/${id}`).expect(400);

        expect(res.body.message).toBe(message);
      },
    );
  });

  describe('POST /movie', () => {
    it('should create a movie with 201 and trimmed strings', async () => {
      const title = `${RUN_PREFIX}Arrival`;

      const res = await createMovie(
        makeMovieBody({
          title: `  ${title} `,
          description: '  Aliens arrive.  ',
        }),
      ).expect(201);

      expect(res.body).toEqual({
        id: expect.any(Number),
        title,
        description: 'Aliens arrive.',
        durationMinutes: 116,
        genre: 'sci-fi',
        releaseDate: '2016-11-11',
        posterUrl: null,
      });
      const row = await movies().findOneByOrFail({ id: res.body.id });
      expect(row.title).toBe(title);
      expect(row.description).toBe('Aliens arrive.');
    });

    it('should store posterUrl as null when it is omitted', async () => {
      const res = await createMovie(makeMovieBody()).expect(201);

      expect(res.body.posterUrl).toBeNull();
      const row = await movies().findOneByOrFail({ id: res.body.id });
      expect(row.posterUrl).toBeNull();
    });

    it('should store an https posterUrl', async () => {
      const res = await createMovie(
        makeMovieBody({ posterUrl: POSTER_URL }),
      ).expect(201);

      expect(res.body.posterUrl).toBe(POSTER_URL);
      const row = await movies().findOneByOrFail({ id: res.body.id });
      expect(row.posterUrl).toBe(POSTER_URL);
    });

    it('should accept a 200-character title', async () => {
      const title = RUN_PREFIX + 'x'.repeat(200 - RUN_PREFIX.length);

      const res = await createMovie(makeMovieBody({ title })).expect(201);

      expect(res.body.title).toBe(title);
    });

    it('should store a 5000-character description and a 2048-character https posterUrl with 201', async () => {
      const description = 'x'.repeat(5000);
      const posterUrl = 'https://example.com/' + 'a'.repeat(2028);
      expect(posterUrl.length).toBe(2048);

      const res = await createMovie(
        makeMovieBody({ title: uniqueTitle(), description, posterUrl }),
      ).expect(201);

      expect(res.body).toMatchObject({ description, posterUrl });
      const row = await movies().findOneByOrFail({ id: res.body.id });
      expect(row.description).toBe(description);
      expect(row.posterUrl).toBe(posterUrl);
    });

    describe('duplicates (same title, description and release date)', () => {
      const DUPLICATE_RESPONSE = {
        statusCode: 409,
        message:
          'A movie with this title, description and release date already exists',
        error: 'Conflict',
      };

      it('should reject a repeated POST with 409 and keep one row', async () => {
        const body = makeMovieBody();

        await createMovie(body).expect(201);
        const second = await createMovie(body).expect(409);

        expect(second.body).toEqual(DUPLICATE_RESPONSE);
        expect(await movies().countBy({ title: body.title })).toBe(1);
      });

      it('should treat bodies that differ only in padding as duplicates (trimmed first)', async () => {
        const body = makeMovieBody();

        await createMovie(body).expect(201);
        await createMovie({
          ...body,
          title: `  ${body.title} `,
          description: ` ${body.description}  `,
        }).expect(409);

        expect(await movies().countBy({ title: body.title })).toBe(1);
      });

      // Probabilistic: five simultaneous requests make it likely that two
      // interleave between check and insert, which only the lock prevents.
      // The unit spec pins the lock itself deterministically.
      it('should create exactly one row for five concurrent identical POSTs', async () => {
        const body = makeMovieBody();

        const statuses = (
          await Promise.all(Array.from({ length: 5 }, () => createMovie(body)))
        )
          .map((res) => res.status)
          .sort();

        expect(statuses).toEqual([201, 409, 409, 409, 409]);
        expect(await movies().countBy({ title: body.title })).toBe(1);
      });

      it('should ignore duration, genre and poster when matching', async () => {
        const body = makeMovieBody();

        await createMovie(body).expect(201);
        await createMovie({
          ...body,
          durationMinutes: 599,
          genre: 'drama',
          posterUrl: 'https://example.com/other.jpg',
        }).expect(409);

        expect(await movies().countBy({ title: body.title })).toBe(1);
      });

      it.each([
        ['a different release date (a remake)', { releaseDate: '1999-01-01' }],
        ['a different description', { description: 'Another cut.' }],
      ])('should allow the same title with %s', async (_label, change) => {
        const body = makeMovieBody();

        const first = await createMovie(body).expect(201);
        const second = await createMovie({ ...body, ...change }).expect(201);

        expect(second.body.id).not.toBe(first.body.id);
        expect(await movies().countBy({ title: body.title })).toBe(2);
      });

      it('should allow re-creating a movie after it was deleted', async () => {
        const body = makeMovieBody();

        const first = await createMovie(body).expect(201);
        await deleteMovie(first.body.id).expect(200);

        await createMovie(body).expect(201);
      });
    });

    const INVALID_BODIES: [string, Record<string, unknown>, string][] = [
      ['an id in the body', { id: 999 }, 'property id should not exist'],
      [
        'a string durationMinutes',
        { durationMinutes: '120' },
        'durationMinutes',
      ],
      [
        'a non-existent releaseDate',
        { releaseDate: '2021-02-29' },
        'releaseDate',
      ],
      [
        'an http posterUrl',
        { posterUrl: 'http://example.com/poster.jpg' },
        'posterUrl',
      ],
      [
        'a 201-character title',
        { title: RUN_PREFIX + 'x'.repeat(201 - RUN_PREFIX.length) },
        'title',
      ],
      [
        'a title containing a NUL byte',
        { title: `${RUN_PREFIX}a\u0000b` },
        'title',
      ],
    ];

    it.each(INVALID_BODIES)(
      'should reject %s with 400 and create no row',
      async (_label, overrides, expected) => {
        const before = await countRunMovies();

        const res = await createMovie(makeMovieBody(overrides)).expect(400);

        expect(res.body.message).toEqual(
          expect.arrayContaining([expect.stringContaining(expected)]),
        );
        expect(await countRunMovies()).toBe(before);
      },
    );
  });

  describe('PATCH /movie/:id', () => {
    it('should change only durationMinutes and return the reloaded movie', async () => {
      const before = await seedMovie({ posterUrl: POSTER_URL });

      const res = await patchMovie(before.id, { durationMinutes: 150 }).expect(
        200,
      );

      const after = await movies().findOneByOrFail({ id: before.id });
      expect(after).toEqual({ ...before, durationMinutes: 150 });
      expect(res.body).toEqual({ ...before, durationMinutes: 150 });
    });

    it('should clear posterUrl in the DB when it is patched to null', async () => {
      const movie = await seedMovie({ posterUrl: POSTER_URL });

      const res = await patchMovie(movie.id, { posterUrl: null }).expect(200);

      expect(res.body.posterUrl).toBeNull();
      const row = await movies().findOneByOrFail({ id: movie.id });
      expect(row.posterUrl).toBeNull();
    });

    it('should reject an empty body with 400 and leave the row unchanged', async () => {
      const before = await seedMovie();

      const res = await patchMovie(before.id, {}).expect(400);

      expect(res.body.message).toBe('No fields to update');
      const after = await movies().findOneByOrFail({ id: before.id });
      expect(after).toEqual(before);
    });

    it('should reject a null title with 400 and leave the row unchanged', async () => {
      const before = await seedMovie();

      const res = await patchMovie(before.id, { title: null }).expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('title')]),
      );
      const after = await movies().findOneByOrFail({ id: before.id });
      expect(after).toEqual(before);
    });

    it('should reject an unknown genre with 400 and leave the row unchanged', async () => {
      const before = await seedMovie();

      const res = await patchMovie(before.id, { genre: 'nope' }).expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('genre')]),
      );
      const after = await movies().findOneByOrFail({ id: before.id });
      expect(after).toEqual(before);
    });

    it('should return 404 with the not-found message for a deleted id', async () => {
      const id = await deletedMovieId();

      const res = await patchMovie(id, { durationMinutes: 100 }).expect(404);

      expect(res.body.message).toBe(notFoundMessage(id));
    });

    it.each(BAD_IDS)(
      'should return 400 for the invalid id %p',
      async (id, message) => {
        const res = await patchMovie(id, { durationMinutes: 100 }).expect(400);

        expect(res.body.message).toBe(message);
      },
    );
  });

  describe('DELETE /movie/:id', () => {
    it('should delete the movie with 200 and an empty body', async () => {
      const movie = await seedMovie();

      const res = await deleteMovie(movie.id).expect(200);

      expect(res.text).toBe('');
      const row = await movies().findOneBy({ id: movie.id });
      expect(row).toBeNull();
    });

    it('should return 404 from GET after the movie is deleted', async () => {
      const movie = await seedMovie();
      await deleteMovie(movie.id).expect(200);

      const res = await request(server()).get(`/movie/${movie.id}`).expect(404);

      expect(res.body.message).toBe(notFoundMessage(movie.id));
    });

    it('should return 404 for a second DELETE of the same id', async () => {
      const movie = await seedMovie();
      await deleteMovie(movie.id).expect(200);

      const res = await deleteMovie(movie.id).expect(404);

      expect(res.body.message).toBe(notFoundMessage(movie.id));
    });

    it('should return 404 with the not-found message for a deleted id', async () => {
      const id = await deletedMovieId();

      const res = await deleteMovie(id).expect(404);

      expect(res.body.message).toBe(notFoundMessage(id));
    });

    it.each(BAD_IDS)(
      'should return 400 for the invalid id %p',
      async (id, message) => {
        const res = await deleteMovie(id).expect(400);

        expect(res.body.message).toBe(message);
      },
    );
  });

  describe('authorization', () => {
    // A 403 (not 401) shows the token was accepted and the role check denied.
    let userToken: string;

    beforeAll(async () => {
      userToken = await seedUserToken();
    });

    it('should reject POST without a token with 401 and create no row', async () => {
      const body = makeMovieBody();

      await request(server()).post('/movie').send(body).expect(401);

      const count = await movies().countBy({ title: body.title });
      expect(count).toBe(0);
    });

    it('should forbid POST from a non-admin with 403 and create no row', async () => {
      const body = makeMovieBody();

      await authed(
        request(server()).post('/movie').send(body),
        userToken,
      ).expect(403);

      const count = await movies().countBy({ title: body.title });
      expect(count).toBe(0);
    });

    it('should reject PATCH without a token with 401 and leave the row unchanged', async () => {
      const before = await seedMovie();

      await request(server())
        .patch(`/movie/${before.id}`)
        .send({ durationMinutes: 99 })
        .expect(401);

      const after = await movies().findOneByOrFail({ id: before.id });
      expect(after).toEqual(before);
    });

    it('should forbid PATCH from a non-admin with 403 and leave the row unchanged', async () => {
      const before = await seedMovie();

      await authed(
        request(server())
          .patch(`/movie/${before.id}`)
          .send({ durationMinutes: 99 }),
        userToken,
      ).expect(403);

      const after = await movies().findOneByOrFail({ id: before.id });
      expect(after).toEqual(before);
    });

    it('should reject DELETE without a token with 401 and keep the row', async () => {
      const before = await seedMovie();

      await request(server()).delete(`/movie/${before.id}`).expect(401);

      const after = await movies().findOneBy({ id: before.id });
      expect(after).toEqual(before);
    });

    it('should forbid DELETE from a non-admin with 403 and keep the row', async () => {
      const before = await seedMovie();

      await authed(
        request(server()).delete(`/movie/${before.id}`),
        userToken,
      ).expect(403);

      const after = await movies().findOneBy({ id: before.id });
      expect(after).toEqual(before);
    });
  });

  describe('logging', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    // MovieService only logs on failed writes, so a successful
    // POST -> PATCH -> DELETE logs nothing.
    it('should not log on any console or Nest Logger channel across a successful POST, PATCH and DELETE', async () => {
      const logging = spyOnAllLogging();

      const created = await createMovie(makeMovieBody()).expect(201);
      await patchMovie(created.body.id, { durationMinutes: 150 }).expect(200);
      await deleteMovie(created.body.id).expect(200);

      logging.expectNoLogging();
    });

    it('should not log on a rejected duplicate POST', async () => {
      const body = makeMovieBody();
      await createMovie(body).expect(201);
      const logging = spyOnAllLogging();

      await createMovie(body).expect(409);

      logging.expectNoLogging();
    });
  });

  // Keep this last: it exhausts GET /movie's per-IP quota for this app
  // instance, which would 429 any later GET /movie.
  describe('rate limit', () => {
    it('should advertise a limit of 100 on GET /movie', async () => {
      const res = await request(server()).get('/movie').expect(200);

      expect(res.headers['x-ratelimit-limit']).toBe('100');
    });

    it('should allow exactly 100 GET /movie requests, give 429 on the 101st, and not throttle GET /movie/:id', async () => {
      // Start from an empty counter, so earlier tests' hits (and their 60 s
      // expiry during this loop) can't move the boundary. storage.clear()
      // is not enough: the count is rebuilt from a second map of hit
      // expirations. onApplicationShutdown() clears both, and the sweep
      // timer restarts on the next hit.
      app
        .get<ThrottlerStorageService>(getStorageToken())
        .onApplicationShutdown();

      for (let i = 1; i <= 100; i++) {
        const res = await request(server()).get('/movie').expect(200);
        expect(res.headers['x-ratelimit-remaining']).toBe(String(100 - i));
      }

      const blocked = await request(server()).get('/movie').expect(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

      const seeded = await seedMovie();
      const byId = await request(server())
        .get(`/movie/${seeded.id}`)
        .expect(200);
      expect(byId.headers['x-ratelimit-limit']).toBeUndefined();
    });
  });
});
