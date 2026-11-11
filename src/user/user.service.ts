import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { QueryFailedError, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);
  private readonly saltRounds: number;

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    configService: ConfigService,
  ) {
    const raw = configService.get<string>('JWT_SALT_OR_ROUNDS');
    if (raw === undefined || raw === '') {
      this.saltRounds = 10;
      return;
    }
    const rounds = Number(raw);
    if (!/^\d+$/.test(raw) || rounds < 10 || rounds > 15) {
      throw new Error(
        'JWT_SALT_OR_ROUNDS must be an integer between 10 and 15',
      );
    }
    this.saltRounds = rounds;
  }

  async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.saltRounds);
  }

  async create(createUserDto: CreateUserDto): Promise<User> {
    try {
      const user = this.userRepository.create({
        ...createUserDto,
        password: await this.hashPassword(createUserDto.password),
      });
      return await this.userRepository.save(user);
    } catch (error) {
      throw this.toHttpError(error, 'create');
    }
  }

  async findAll(): Promise<User[]> {
    const users = await this.userRepository.find();
    if (!users) {
      throw new NotFoundException('No users found');
    }
    return users;
  }

  async findOne(id: number): Promise<User> {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async findOneByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOneBy({ email });
  }

  async update(id: number, updateUserDto: UpdateUserDto): Promise<User> {
    if (Object.values(updateUserDto).every((v) => v === undefined)) {
      throw new BadRequestException('No fields to update');
    }

    const { password } = updateUserDto;
    if (
      password !== undefined &&
      (typeof password !== 'string' || password === '')
    ) {
      throw new BadRequestException('password must not be empty');
    }

    await this.findOne(id);

    try {
      const data =
        updateUserDto.password != null
          ? {
              ...updateUserDto,
              password: await this.hashPassword(updateUserDto.password),
            }
          : updateUserDto;
      await this.userRepository.update(id, data);
    } catch (error) {
      throw this.toHttpError(error, 'update');
    }

    return this.findOne(id);
  }

  async remove(id: number): Promise<void> {
    await this.findOne(id);

    try {
      await this.userRepository.delete(id);
    } catch (error) {
      throw this.toHttpError(error, 'remove');
    }
  }

  // Maps a write failure to an HTTP error. Logs only the error's name,
  // message and stack: TypeORM's query/parameters hold the email and hash.
  private toHttpError(
    error: unknown,
    action: 'create' | 'update' | 'remove',
  ): HttpException {
    if (error instanceof HttpException) {
      return error;
    }
    if (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string } | undefined)?.code === '23505'
    ) {
      return new ConflictException('Email already in use');
    }

    const e: Pick<Error, 'name' | 'message' | 'stack'> =
      error instanceof Error
        ? error
        : { name: 'Error', message: 'Non-Error thrown' };
    this.logger.error(
      `Failed to ${action} user: ${e.name}: ${e.message}`,
      e.stack,
    );
    return new InternalServerErrorException(`Failed to ${action} user`);
  }
}
