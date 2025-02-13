import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { UserService } from '../user/user.service';
import { JwtService } from '@nestjs/jwt';
import { CreateUserDto } from 'src/user/dto/create-user.dto';
import * as bcrypt from 'bcrypt';
import { User } from 'src/user/entities/user.entity';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UserService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  private saltOrRounds =
    this.configService.get<number | string>('JWT_SALT_OR_ROUNDS') || 10;

  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.usersService.findOneByEmail(email);

    const isMatch = user && (await bcrypt.compare(pass, user.password));

    if (isMatch) {
      const { password, ...result } = user;
      return result;
    }
    return null;
  }

  async signUp(payload: CreateUserDto): Promise<User> {
    if (!payload) {
      throw new Error('Invalid user data');
    }

    const hashPass = await bcrypt.hash(payload.password, this.saltOrRounds);

    const data = {
      ...payload,
      password: hashPass,
    };

    try {
      return await this.usersService.create(data);
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to create user: ${error.message}`,
      );
    }
  }

  async login(user: User) {
    const payload = { email: user.email, sub: user.id };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }
}
