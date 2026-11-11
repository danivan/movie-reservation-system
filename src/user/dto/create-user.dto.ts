import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { NO_NUL, NO_NUL_OPTIONS, trim } from 'src/common/string-validation';

export class CreateUserDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @Matches(NO_NUL, NO_NUL_OPTIONS)
  firstname: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @Matches(NO_NUL, NO_NUL_OPTIONS)
  lastname: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(NO_NUL, NO_NUL_OPTIONS)
  password: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  isAdmin?: boolean;
}
