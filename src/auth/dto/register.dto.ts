import { OmitType } from '@nestjs/mapped-types';
import { CreateUserDto } from 'src/user/dto/create-user.dto';

export class RegisterDto extends OmitType(CreateUserDto, [
  'isAdmin',
] as const) {}
