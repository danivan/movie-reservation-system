import {
  BadRequestException,
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

  async create(createMovieDto: CreateMovieDto): Promise<Movie> {
    try {
      const movie = this.movieRepository.create(createMovieDto);
      return await this.movieRepository.save(movie);
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
  // Movie has no unique column, so a 23505 is unexpected and becomes a 500.
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
