import { IsEnum, ValidateIf } from 'class-validator';
import { Genre } from 'src/types';

export class FindMoviesQueryDto {
  @ValidateIf((_, v) => v !== undefined)
  @IsEnum(Genre)
  genre?: Genre;
}
