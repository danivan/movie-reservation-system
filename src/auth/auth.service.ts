import { Injectable, OnModuleInit } from '@nestjs/common';
import { UserService } from '../user/user.service';
import { JwtService } from '@nestjs/jwt';
import { RegisterDto } from './dto/register.dto';
import * as bcrypt from 'bcrypt';
import { User } from 'src/user/entities/user.entity';
import { randomBytes } from 'crypto';

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash?: Promise<string>;

  constructor(
    private readonly usersService: UserService,
    private readonly jwtService: JwtService,
  ) {}

  onModuleInit(): void {
    // Warm the dummy hash so the first unknown-email login isn't slower (G7).
    this.getDummyHash().catch(() => undefined);
  }

  private getDummyHash(): Promise<string> {
    // Clear the cache on rejection so the next caller retries.
    return (this.dummyHash ??= this.usersService
      .hashPassword(randomBytes(16).toString('hex'))
      .catch((error: unknown) => {
        this.dummyHash = undefined;
        throw error;
      }));
  }

  async validateUser(
    email: unknown,
    pass: unknown,
  ): Promise<Omit<User, 'password'> | null> {
    // Login bypasses the ValidationPipe; reject non-strings before any work.
    if (typeof email !== 'string' || typeof pass !== 'string') {
      return null;
    }
    // Postgres rejects U+0000 in text, so the lookup would 500.
    if (email.includes('\u0000')) {
      return null;
    }

    const normalised = email.trim().toLowerCase();
    const user = await this.usersService.findOneByEmail(normalised);

    if (!user) {
      // Equalise timing with the wrong-password path (G7).
      await bcrypt.compare(pass, await this.getDummyHash());
      return null;
    }

    const isMatch = await bcrypt.compare(pass, user.password);
    if (!isMatch) {
      return null;
    }

    const { password, ...result } = user;
    return result;
  }

  async signUp(payload: RegisterDto): Promise<User> {
    return this.usersService.create({ ...payload, isAdmin: false });
  }

  async login(user: User) {
    const payload = { email: user.email, sub: user.id, isAdmin: user.isAdmin };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }
}
