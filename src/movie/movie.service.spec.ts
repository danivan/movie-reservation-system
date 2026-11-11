import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { Genre } from 'src/types';
import { spyOnAllLogging } from '../../test/utils/spy-on-logging';
import { MovieService } from './movie.service';
import { Movie } from './entities/movie.entity';
import { CreateMovieDto } from './dto/create-movie.dto';
import { UpdateMovieDto } from './dto/update-movie.dto';

describe('MovieService', () => {
  let service: MovieService;
  let logging: ReturnType<typeof spyOnAllLogging>;
  const mockMovieRepository = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOneBy: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  // Added by the repo.create stub, so save() must receive the created entity
  // rather than the raw dto.
  const CREATED_MARKER = 'created-by-repo';

  const makeCreateMovieDto = (
    overrides: Partial<CreateMovieDto> = {},
  ): CreateMovieDto => ({
    title: 'Arrival',
    description: 'A linguist works with the military to talk to aliens.',
    durationMinutes: 116,
    genre: Genre.SCI_FI,
    releaseDate: '2016-11-11',
    ...overrides,
  });

  const makeMovie = (overrides: Partial<Movie> = {}): Movie => ({
    id: 1,
    title: 'Arrival',
    description: 'A linguist works with the military to talk to aliens.',
    durationMinutes: 116,
    genre: Genre.SCI_FI,
    releaseDate: '2016-11-11',
    posterUrl: null,
    ...overrides,
  });

  // Values a real INSERT/UPDATE would carry; they must never reach a client
  // or the log.
  const SECRET_QUERY =
    'INSERT INTO "movie"("title", "description") VALUES ($1, $2)';
  const SECRET_TITLE = 'secret-title-7f3a';
  const SECRET_DESCRIPTION = 'secret-description-91bc';
  const DB_TEXT = 'connection refused at 10.0.0.5';

  // A TypeORM driver error as Postgres reports it, carrying the SQL text and
  // parameters like a real failed write.
  const queryFailed = (code: string, message: string) =>
    new QueryFailedError(
      SECRET_QUERY,
      [SECRET_TITLE, SECRET_DESCRIPTION],
      Object.assign(new Error(message), { code }),
    );

  // Everything a log argument could expose: plain values, and for errors the
  // message, stack and own enumerable props (query, parameters, ...).
  const stringifyLogArg = (arg: unknown): string => {
    if (arg instanceof Error) {
      return [String(arg), arg.stack, JSON.stringify(arg)].join('\n');
    }
    return typeof arg === 'string' ? arg : String(JSON.stringify(arg));
  };

  // All arguments passed to any console or Nest Logger channel.
  const loggedOutput = () =>
    logging.spies
      .flatMap(({ spy }) => spy.mock.calls)
      .flat()
      .map(stringifyLogArg)
      .join('\n');

  // Every non-HTTP failure a write can reject with. Factories, so each test
  // gets a fresh value.
  const NON_HTTP_ERRORS: [string, () => unknown][] = [
    [
      'a 23505 unique violation',
      () =>
        queryFailed('23505', 'duplicate key value violates unique constraint'),
    ],
    ['a non-unique QueryFailedError', () => queryFailed('XX000', 'boom')],
    ['a plain Error', () => new Error(DB_TEXT)],
    ['an undefined rejection', () => undefined],
    ['a string rejection', () => DB_TEXT],
    [
      'a raw driver-style object',
      () => ({
        query: SECRET_QUERY,
        parameters: [SECRET_TITLE, SECRET_DESCRIPTION],
      }),
    ],
  ];

  // Rejections that carry the query text and parameters.
  const LEAKY_ERRORS = NON_HTTP_ERRORS.filter(([label]) =>
    [
      'a 23505 unique violation',
      'a non-unique QueryFailedError',
      'a raw driver-style object',
    ].includes(label),
  );

  // Registers the shared write-error tests for one service method.
  // `fail` makes the method's write call reject; `run` invokes the method.
  const itMapsWriteErrors = (
    action: 'create' | 'update' | 'remove',
    fail: (err: unknown) => void,
    run: () => Promise<unknown>,
  ) => {
    const expectedMessage = `Failed to ${action} movie`;

    it.each(NON_HTTP_ERRORS)(
      `should map %s to InternalServerErrorException '${expectedMessage}'`,
      async (_label, makeError) => {
        fail(makeError());

        const result = run();

        await expect(result).rejects.toBeInstanceOf(
          InternalServerErrorException,
        );
        await expect(result).rejects.toMatchObject({
          message: expectedMessage,
        });
        // The whole body, so no DB text can leak via a description either.
        const err: unknown = await result.catch((e: unknown) => e);
        expect((err as InternalServerErrorException).getResponse()).toEqual({
          statusCode: 500,
          message: expectedMessage,
          error: 'Internal Server Error',
        });
      },
    );

    it('should not map a 23505 unique violation to ConflictException', async () => {
      fail(
        queryFailed('23505', 'duplicate key value violates unique constraint'),
      );

      await expect(run()).rejects.not.toBeInstanceOf(ConflictException);
    });

    it.each(LEAKY_ERRORS)(
      'should log %s without the query text or parameters',
      async (_label, makeError) => {
        fail(makeError());

        await expect(run()).rejects.toBeInstanceOf(
          InternalServerErrorException,
        );

        const logged = loggedOutput();
        expect(logged).not.toContain('INSERT INTO');
        expect(logged).not.toContain(SECRET_TITLE);
        expect(logged).not.toContain(SECRET_DESCRIPTION);
      },
    );

    it("should log the error's name, message and stack via the Nest Logger", async () => {
      const injected = queryFailed('XX000', 'boom');
      fail(injected);

      await expect(run()).rejects.toBeInstanceOf(InternalServerErrorException);

      const channels = logging.calls();
      expect(channels.some((c) => c.startsWith('Logger'))).toBe(true);
      expect(channels.filter((c) => c.startsWith('console.'))).toEqual([]);
      const logged = loggedOutput();
      expect(logged).toContain('QueryFailedError');
      expect(logged).toContain('boom');
      expect(injected.stack).toEqual(expect.any(String));
      expect(logged).toContain(injected.stack);
    });

    it('should rethrow an HttpException unchanged', async () => {
      const err = new BadRequestException('x');
      fail(err);

      await expect(run()).rejects.toBe(err);
    });
  };

  beforeEach(async () => {
    // resetAllMocks (not clearAllMocks) so no implementation or *Once queue
    // leaks from one test into the next; every default is re-stubbed below.
    jest.resetAllMocks();
    mockMovieRepository.create.mockImplementation((data) => ({
      ...data,
      marker: CREATED_MARKER,
    }));
    mockMovieRepository.save.mockImplementation(async (entity) => ({
      id: 1,
      ...entity,
    }));
    mockMovieRepository.find.mockResolvedValue([]);
    mockMovieRepository.findOneBy.mockResolvedValue(makeMovie());
    mockMovieRepository.update.mockResolvedValue({ affected: 1 });
    mockMovieRepository.delete.mockResolvedValue({ affected: 1 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MovieService,
        { provide: getRepositoryToken(Movie), useValue: mockMovieRepository },
      ],
    }).compile();

    service = module.get<MovieService>(MovieService);
    // Spy after compile so only the service call is inside the spy window.
    logging = spyOnAllLogging();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should pass the dto to repo.create', async () => {
      await service.create(makeCreateMovieDto());

      expect(mockMovieRepository.create).toHaveBeenCalledWith({
        title: 'Arrival',
        description: 'A linguist works with the military to talk to aliens.',
        durationMinutes: 116,
        genre: Genre.SCI_FI,
        releaseDate: '2016-11-11',
      });
    });

    it('should save the entity returned by repo.create', async () => {
      await service.create(makeCreateMovieDto());

      expect(mockMovieRepository.save).toHaveBeenCalledWith({
        title: 'Arrival',
        description: 'A linguist works with the military to talk to aliens.',
        durationMinutes: 116,
        genre: Genre.SCI_FI,
        releaseDate: '2016-11-11',
        marker: CREATED_MARKER,
      });
    });

    it('should return the saved movie', async () => {
      await expect(
        service.create(makeCreateMovieDto({ title: 'Dune' })),
      ).resolves.toEqual({
        id: 1,
        title: 'Dune',
        description: 'A linguist works with the military to talk to aliens.',
        durationMinutes: 116,
        genre: Genre.SCI_FI,
        releaseDate: '2016-11-11',
        marker: CREATED_MARKER,
      });
    });

    it('should log nothing on a successful create', async () => {
      await service.create(makeCreateMovieDto());

      logging.expectNoLogging();
    });

    itMapsWriteErrors(
      'create',
      (err) => mockMovieRepository.save.mockRejectedValue(err),
      () =>
        service.create(
          makeCreateMovieDto({
            title: SECRET_TITLE,
            description: SECRET_DESCRIPTION,
          }),
        ),
    );
  });

  describe('findAll', () => {
    it('should find all movies ordered by title then id when no genre is given', async () => {
      await service.findAll({});

      expect(mockMovieRepository.find).toHaveBeenCalledWith({
        where: {},
        order: { title: 'ASC', id: 'ASC' },
      });
    });

    it('should treat an explicitly undefined genre as no filter', async () => {
      await service.findAll({ genre: undefined });

      expect(mockMovieRepository.find).toHaveBeenCalledWith({
        where: {},
        order: { title: 'ASC', id: 'ASC' },
      });
    });

    it('should filter by genre when one is given', async () => {
      await service.findAll({ genre: Genre.HORROR });

      expect(mockMovieRepository.find).toHaveBeenCalledWith({
        where: { genre: Genre.HORROR },
        order: { title: 'ASC', id: 'ASC' },
      });
    });

    // toHaveBeenCalledWith ignores key order, which decides the sort.
    it('should order by title before id', async () => {
      await service.findAll({});

      const [options] = mockMovieRepository.find.mock.calls[0] as [
        { order: object },
      ];
      expect(Object.keys(options.order)).toEqual(['title', 'id']);
    });

    it('should return the movies in the order the repository returns them', async () => {
      mockMovieRepository.find.mockResolvedValue([
        makeMovie({ id: 2, title: 'Alien' }),
        makeMovie({ id: 1, title: 'Arrival' }),
      ]);

      await expect(service.findAll({})).resolves.toEqual([
        makeMovie({ id: 2, title: 'Alien' }),
        makeMovie({ id: 1, title: 'Arrival' }),
      ]);
    });

    it('should return an empty array, not NotFoundException, when nothing matches', async () => {
      mockMovieRepository.find.mockResolvedValue([]);

      const result = await service.findAll({ genre: Genre.DRAMA });

      expect(result).toEqual([]);
    });
  });

  describe('findOne', () => {
    it('should look the movie up by id and return it', async () => {
      mockMovieRepository.findOneBy.mockResolvedValue(
        makeMovie({ id: 5, title: 'Heat' }),
      );

      await expect(service.findOne(5)).resolves.toEqual(
        makeMovie({ id: 5, title: 'Heat' }),
      );
      expect(mockMovieRepository.findOneBy).toHaveBeenCalledWith({ id: 5 });
    });

    it("should throw NotFoundException 'Movie with ID 99 not found' when the movie does not exist", async () => {
      mockMovieRepository.findOneBy.mockResolvedValue(null);

      const result = service.findOne(99);

      await expect(result).rejects.toBeInstanceOf(NotFoundException);
      await expect(result).rejects.toMatchObject({
        message: 'Movie with ID 99 not found',
      });
    });
  });

  describe('update', () => {
    it.each<[string, UpdateMovieDto]>([
      ['an empty dto', {}],
      ['a dto whose only key is undefined', { title: undefined }],
      [
        'a dto whose keys are all undefined',
        { title: undefined, genre: undefined, posterUrl: undefined },
      ],
    ])(
      "should throw BadRequestException 'No fields to update' for %s without any repository call",
      async (_label, dto) => {
        const result = service.update(1, dto);

        await expect(result).rejects.toBeInstanceOf(BadRequestException);
        await expect(result).rejects.toMatchObject({
          message: 'No fields to update',
        });
        for (const fn of Object.values(mockMovieRepository)) {
          expect(fn).not.toHaveBeenCalled();
        }
      },
    );

    it('should treat { posterUrl: null } as a field to update', async () => {
      await expect(service.update(1, { posterUrl: null })).resolves.toEqual(
        makeMovie(),
      );

      expect(mockMovieRepository.update).toHaveBeenCalledWith(1, {
        posterUrl: null,
      });
    });

    it('should pass the id and dto to repo.update', async () => {
      await service.update(3, { durationMinutes: 150 });

      expect(mockMovieRepository.update).toHaveBeenCalledWith(3, {
        durationMinutes: 150,
      });
    });

    it("should throw NotFoundException 'Movie with ID 99 not found' for an unknown id without updating", async () => {
      mockMovieRepository.findOneBy.mockResolvedValue(null);

      const result = service.update(99, { title: 'Dune' });

      await expect(result).rejects.toBeInstanceOf(NotFoundException);
      await expect(result).rejects.toMatchObject({
        message: 'Movie with ID 99 not found',
      });
      expect(mockMovieRepository.findOneBy).toHaveBeenCalledWith({ id: 99 });
      expect(mockMovieRepository.update).not.toHaveBeenCalled();
    });

    it('should return the movie reloaded after the update (second findOneBy result)', async () => {
      // durationMinutes differs from the first result and is not in the dto,
      // so a merge of the first result with the dto can't match it.
      const reloaded = makeMovie({
        id: 1,
        title: 'After',
        durationMinutes: 999,
      });
      mockMovieRepository.findOneBy
        .mockResolvedValueOnce(makeMovie({ id: 1, title: 'Before' }))
        .mockResolvedValueOnce(reloaded);

      await expect(service.update(1, { title: 'After' })).resolves.toBe(
        reloaded,
      );
      expect(mockMovieRepository.findOneBy).toHaveBeenNthCalledWith(2, {
        id: 1,
      });
    });

    it('should check existence before updating and reload after updating', async () => {
      await service.update(1, { title: 'After' });

      const [checkOrder, reloadOrder] =
        mockMovieRepository.findOneBy.mock.invocationCallOrder;
      const [updateOrder] = mockMovieRepository.update.mock.invocationCallOrder;
      expect(checkOrder).toBeLessThan(updateOrder);
      expect(updateOrder).toBeLessThan(reloadOrder);
    });

    it('should throw NotFoundException when the movie is gone by the reload', async () => {
      mockMovieRepository.findOneBy
        .mockResolvedValueOnce(makeMovie({ id: 1 }))
        .mockResolvedValueOnce(null);

      const result = service.update(1, { title: 'After' });

      await expect(result).rejects.toBeInstanceOf(NotFoundException);
      await expect(result).rejects.toMatchObject({
        message: 'Movie with ID 1 not found',
      });
    });

    it('should log nothing on a successful update', async () => {
      await service.update(1, { title: 'After' });

      logging.expectNoLogging();
    });

    itMapsWriteErrors(
      'update',
      (err) => mockMovieRepository.update.mockRejectedValue(err),
      () =>
        service.update(1, {
          title: SECRET_TITLE,
          description: SECRET_DESCRIPTION,
        }),
    );
  });

  describe('remove', () => {
    it('should delete an existing movie and resolve undefined', async () => {
      mockMovieRepository.findOneBy.mockResolvedValue(makeMovie({ id: 2 }));

      await expect(service.remove(2)).resolves.toBeUndefined();

      expect(mockMovieRepository.findOneBy).toHaveBeenCalledWith({ id: 2 });
      expect(mockMovieRepository.delete).toHaveBeenCalledWith(2);
    });

    it("should throw NotFoundException 'Movie with ID 99 not found' for an unknown id without deleting", async () => {
      mockMovieRepository.findOneBy.mockResolvedValue(null);

      const result = service.remove(99);

      await expect(result).rejects.toBeInstanceOf(NotFoundException);
      await expect(result).rejects.toMatchObject({
        message: 'Movie with ID 99 not found',
      });
      expect(mockMovieRepository.delete).not.toHaveBeenCalled();
    });

    it('should log nothing on a successful remove', async () => {
      await service.remove(2);

      logging.expectNoLogging();
    });

    itMapsWriteErrors(
      'remove',
      (err) => mockMovieRepository.delete.mockRejectedValue(err),
      () => service.remove(2),
    );
  });
});
