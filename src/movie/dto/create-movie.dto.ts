import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { NO_NUL, NO_NUL_OPTIONS, trim } from 'src/common/string-validation';
import { Genre } from 'src/types';

export class CreateMovieDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Matches(NO_NUL, NO_NUL_OPTIONS)
  title: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  @Matches(NO_NUL, NO_NUL_OPTIONS)
  description: string;

  @IsInt()
  @Min(1)
  @Max(600)
  durationMinutes: number;

  @IsEnum(Genre)
  genre: Genre;

  @Matches(/^(18|19|20|21)\d{2}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  releaseDate: string;

  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  posterUrl?: string | null;
}
