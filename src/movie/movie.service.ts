import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateMovieDto } from './dto/create-movie.dto';
import { UpdateMovieDto } from './dto/update-movie.dto';
import { FindMoviesQueryDto } from './dto/find-movies-query.dto';
import { Movie } from './entities/movie.entity';

@Injectable()
export class MovieService {
  private readonly logger = new Logger(MovieService.name);

  constructor(
    @InjectRepository(Movie)
    private movieRepository: Repository<Movie>,
  ) {}

  // Rejects an accidental double submit: a movie with the same title,
  // description and release date gives 409. There is no unique index (a
  // 5000-char description is too large for a btree), so the check runs
  // under a transaction-scoped advisory lock on title + release date. Two
  // concurrent identical requests then can't both pass the check. READ
  // COMMITTED is pinned: existsBy must see rows committed while it waited on
  // the lock, which a REPEATABLE READ snapshot (taken at the lock) would not.
  async create(createMovieDto: CreateMovieDto): Promise<Movie> {
    const { title, description, releaseDate } = createMovieDto;

    try {
      return await this.movieRepository.manager.transaction(
        'READ COMMITTED',
        async (manager) => {
          await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
            `movie:${JSON.stringify([title, releaseDate])}`,
          ]);

          const movies = manager.getRepository(Movie);
          if (await movies.existsBy({ title, description, releaseDate })) {
            throw new ConflictException(
              'A movie with this title, description and release date already exists',
            );
          }

          return movies.save(movies.create(createMovieDto));
        },
      );
    } catch (error) {
      throw this.toHttpError(error, 'create');
    }
  }

  async findAll(query: FindMoviesQueryDto): Promise<Movie[]> {
    return this.movieRepository.find({
      where: query.genre === undefined ? {} : { genre: query.genre },
      order: { title: 'ASC', id: 'ASC' },
    });
  }

  async findOne(id: number): Promise<Movie> {
    const movie = await this.movieRepository.findOneBy({ id });
    if (!movie) {
      throw new NotFoundException(`Movie with ID ${id} not found`);
    }
    return movie;
  }

  async update(id: number, updateMovieDto: UpdateMovieDto): Promise<Movie> {
    if (Object.values(updateMovieDto).every((v) => v === undefined)) {
      throw new BadRequestException('No fields to update');
    }

    await this.findOne(id);

    try {
      await this.movieRepository.update(id, updateMovieDto);
    } catch (error) {
      throw this.toHttpError(error, 'update');
    }

    return this.findOne(id);
  }

  async remove(id: number): Promise<void> {
    await this.findOne(id);

    try {
      await this.movieRepository.delete(id);
    } catch (error) {
      throw this.toHttpError(error, 'remove');
    }
  }

  // Maps a write failure to an HTTP error. Logs only the error's name,
  // message and stack: TypeORM's query/parameters hold the request data.
  // Movie has no unique column, so a 23505 is unexpected and becomes a 500;
  // duplicates are caught in create() as a ConflictException, which passes
  // through here unchanged.
  private toHttpError(
    error: unknown,
    action: 'create' | 'update' | 'remove',
  ): HttpException {
    if (error instanceof HttpException) {
      return error;
    }

    const e: Pick<Error, 'name' | 'message' | 'stack'> =
      error instanceof Error
        ? error
        : { name: 'Error', message: 'Non-Error thrown' };
    this.logger.error(
      `Failed to ${action} movie: ${e.name}: ${e.message}`,
      e.stack,
    );
    return new InternalServerErrorException(`Failed to ${action} movie`);
  }
}
