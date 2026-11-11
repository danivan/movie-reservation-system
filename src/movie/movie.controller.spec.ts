import { Test, TestingModule } from '@nestjs/testing';
import {
  CUSTOM_ROUTE_ARGS_METADATA,
  GUARDS_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  THROTTLER_LIMIT,
  THROTTLER_TTL,
} from '@nestjs/throttler/dist/throttler.constants';
import { ParseIdPipe } from 'src/pipes/parse-id.pipe';
import { ROLES_KEY } from 'src/decorators/role.decorator';
import { IS_PUBLIC_KEY } from 'src/decorators/public.decorator';
import { Genre, Role } from 'src/types';
import { MovieController } from './movie.controller';
import { MovieService } from './movie.service';
import { CreateMovieDto } from './dto/create-movie.dto';
import { UpdateMovieDto } from './dto/update-movie.dto';

type RouteArg = {
  data?: unknown;
  pipes?: unknown[];
  factory?: (data: unknown, ctx: unknown) => unknown;
};

describe('MovieController', () => {
  let controller: MovieController;
  const mockMovieService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  const makeMovie = (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    title: 'Arrival',
    description: 'A linguist works with the military to talk to aliens.',
    durationMinutes: 116,
    genre: Genre.SCI_FI,
    releaseDate: '2016-11-11',
    posterUrl: null,
    ...overrides,
  });

  // The metadata key and entry of the `id` route arg of a controller method.
  const idRouteArg = (method: string): [string, RouteArg] | undefined => {
    const args: Record<string, RouteArg> =
      Reflect.getMetadata(ROUTE_ARGS_METADATA, MovieController, method) ?? {};
    return Object.entries(args).find(([, arg]) => arg.data === 'id');
  };

  // A minimal HTTP context whose request carries the given raw route params.
  const httpContextWithParams = (params: Record<string, string>) => ({
    switchToHttp: () => ({ getRequest: () => ({ params }) }),
  });

  const WRITE_METHODS = ['create', 'update', 'remove'] as const;
  const READ_METHODS = ['findAll', 'findOne'] as const;

  beforeEach(async () => {
    // resetAllMocks so no implementation or *Once queue leaks between tests;
    // each test stubs the service calls it relies on.
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MovieController],
      providers: [{ provide: MovieService, useValue: mockMovieService }],
    })
      // The rate limit itself is covered in test/movie.e2e-spec.ts; here the
      // guard only needs to resolve without ThrottlerModule.
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<MovieController>(MovieController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('id param', () => {
    const ID_METHODS = ['findOne', 'update', 'remove'];

    // A custom decorator is skipped by the global ValidationPipe, so the raw
    // string (not `+value`) reaches ParseIdPipe.
    it.each(ID_METHODS)(
      'should bind the id of %s as a custom route arg',
      (method) => {
        const key = idRouteArg(method)?.[0];

        expect(key).toEqual(
          expect.stringContaining(CUSTOM_ROUTE_ARGS_METADATA),
        );
      },
    );

    it.each(ID_METHODS)(
      'should parse the id of %s with ParseIdPipe',
      (method) => {
        const pipes = idRouteArg(method)?.[1].pipes ?? [];

        expect(
          pipes.some((p) => p === ParseIdPipe || p instanceof ParseIdPipe),
        ).toBe(true);
      },
    );

    it.each(ID_METHODS)(
      'should extract the raw id string of %s from the request params',
      (method) => {
        const arg = idRouteArg(method)?.[1];
        const ctx = httpContextWithParams({ id: '0x10' });

        expect(typeof arg?.factory).toBe('function');
        expect(arg?.factory?.('id', ctx)).toBe('0x10');
      },
    );
  });

  describe('roles', () => {
    // RolesGuard reads this metadata; the e2e authorization tests cover the
    // guard itself.
    it.each(WRITE_METHODS)('should restrict %s to admins', (method) => {
      const roles = Reflect.getMetadata(
        ROLES_KEY,
        MovieController.prototype[method],
      );

      expect(roles).toEqual([Role.ADMIN]);
    });

    it.each(READ_METHODS)('should not restrict %s by role', (method) => {
      const roles = Reflect.getMetadata(
        ROLES_KEY,
        MovieController.prototype[method],
      );

      expect(roles).toBeUndefined();
    });

    it('should not set roles on the controller class', () => {
      expect(Reflect.getMetadata(ROLES_KEY, MovieController)).toBeUndefined();
    });
  });

  describe('public', () => {
    it.each(READ_METHODS)('should mark %s as public', (method) => {
      const isPublic = Reflect.getMetadata(
        IS_PUBLIC_KEY,
        MovieController.prototype[method],
      );

      expect(isPublic).toBe(true);
    });

    it.each(WRITE_METHODS)('should not mark %s as public', (method) => {
      const isPublic = Reflect.getMetadata(
        IS_PUBLIC_KEY,
        MovieController.prototype[method],
      );

      expect(isPublic).toBeUndefined();
    });

    it('should not mark the controller class as public', () => {
      expect(
        Reflect.getMetadata(IS_PUBLIC_KEY, MovieController),
      ).toBeUndefined();
    });
  });

  describe('throttle', () => {
    const OTHER_METHODS = ['findOne', ...WRITE_METHODS] as const;
    const guardsOf = (target: object): unknown[] =>
      Reflect.getMetadata(GUARDS_METADATA, target) ?? [];

    it('should guard findAll with ThrottlerGuard', () => {
      expect(guardsOf(MovieController.prototype.findAll)).toEqual([
        ThrottlerGuard,
      ]);
    });

    it('should limit findAll to 100 requests per 60000 ms', () => {
      const findAll = MovieController.prototype.findAll;

      expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, findAll)).toBe(
        100,
      );
      expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, findAll)).toBe(
        60000,
      );
    });

    it.each(OTHER_METHODS)('should not throttle %s', (method) => {
      const handler = MovieController.prototype[method];

      expect(guardsOf(handler)).toEqual([]);
      expect(
        Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler),
      ).toBeUndefined();
    });

    it('should not guard or throttle the controller class', () => {
      expect(guardsOf(MovieController)).toEqual([]);
      expect(
        Reflect.getMetadata(`${THROTTLER_LIMIT}default`, MovieController),
      ).toBeUndefined();
    });
  });

  describe('findAll', () => {
    it('should pass the genre query to the service and return its movies', async () => {
      const movies = [makeMovie({ id: 4, genre: Genre.HORROR })];
      mockMovieService.findAll.mockResolvedValue(movies);

      const result = await controller.findAll({ genre: Genre.HORROR });

      expect(mockMovieService.findAll).toHaveBeenCalledWith({
        genre: Genre.HORROR,
      });
      expect(result).toBe(movies);
    });

    it('should pass an empty query to the service unchanged', async () => {
      mockMovieService.findAll.mockResolvedValue([]);

      await controller.findAll({});

      expect(mockMovieService.findAll).toHaveBeenCalledWith({});
    });
  });

  describe('findOne', () => {
    it('should pass the numeric id to the service and return its movie', async () => {
      const movie = makeMovie({ id: 7 });
      mockMovieService.findOne.mockResolvedValue(movie);

      const result = await controller.findOne(7);

      expect(mockMovieService.findOne).toHaveBeenCalledWith(7);
      expect(result).toBe(movie);
    });
  });

  describe('create', () => {
    it('should pass the dto to the service and return the created movie', async () => {
      const dto: CreateMovieDto = {
        title: 'Arrival',
        description: 'A linguist works with the military to talk to aliens.',
        durationMinutes: 116,
        genre: Genre.SCI_FI,
        releaseDate: '2016-11-11',
      };
      const created = makeMovie({ id: 9 });
      mockMovieService.create.mockResolvedValue(created);

      const result = await controller.create(dto);

      expect(mockMovieService.create).toHaveBeenCalledWith(dto);
      expect(result).toBe(created);
    });
  });

  describe('update', () => {
    it('should pass the numeric id and dto to the service and return its movie', async () => {
      const dto: UpdateMovieDto = { durationMinutes: 150 };
      const updated = makeMovie({ id: 3, durationMinutes: 150 });
      mockMovieService.update.mockResolvedValue(updated);

      const result = await controller.update(3, dto);

      expect(mockMovieService.update).toHaveBeenCalledWith(3, dto);
      expect(result).toBe(updated);
    });

    it('should pass { posterUrl: null } to the service unchanged', async () => {
      mockMovieService.update.mockResolvedValue(makeMovie());

      await controller.update(1, { posterUrl: null });

      expect(mockMovieService.update).toHaveBeenCalledWith(1, {
        posterUrl: null,
      });
    });
  });

  describe('remove', () => {
    it('should delegate to the service with the numeric id', async () => {
      mockMovieService.remove.mockResolvedValue(undefined);

      await expect(controller.remove(2)).resolves.toBeUndefined();

      expect(mockMovieService.remove).toHaveBeenCalledWith(2);
    });
  });
});
