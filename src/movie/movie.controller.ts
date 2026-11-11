import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Delete,
  Query,
  UseInterceptors,
  ClassSerializerInterceptor,
} from '@nestjs/common';
import { MovieService } from './movie.service';
import { CreateMovieDto } from './dto/create-movie.dto';
import { UpdateMovieDto } from './dto/update-movie.dto';
import { FindMoviesQueryDto } from './dto/find-movies-query.dto';
import { Role } from 'src/types';
import { Roles } from 'src/decorators/role.decorator';
import { Public } from 'src/decorators/public.decorator';
import { IdParam } from 'src/decorators/id-param.decorator';

@Controller('movie')
@UseInterceptors(ClassSerializerInterceptor)
export class MovieController {
  constructor(private readonly movieService: MovieService) {}

  @Post()
  @Roles(Role.ADMIN)
  create(@Body() createMovieDto: CreateMovieDto) {
    return this.movieService.create(createMovieDto);
  }

  @Get()
  @Public()
  findAll(@Query() query: FindMoviesQueryDto) {
    return this.movieService.findAll(query);
  }

  @Get(':id')
  @Public()
  findOne(@IdParam() id: number) {
    return this.movieService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(@IdParam() id: number, @Body() updateMovieDto: UpdateMovieDto) {
    return this.movieService.update(id, updateMovieDto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@IdParam() id: number) {
    return this.movieService.remove(id);
  }
}
