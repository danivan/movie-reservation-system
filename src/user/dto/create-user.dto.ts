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

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Postgres text rejects U+0000, and native bcrypt hashes an all-NUL
// password the same as an empty one (G21).
const NO_NUL = /^[^\u0000]*$/;
const NO_NUL_OPTIONS = {
  message: '$property must not contain NUL characters',
};

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
