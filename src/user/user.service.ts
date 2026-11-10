import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UserService {
  private readonly saltRounds: number;

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private readonly configService: ConfigService,
  ) {
    const raw = this.configService.get<string>('JWT_SALT_OR_ROUNDS');
    if (raw === undefined || raw === null || raw === '') {
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

  private async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.saltRounds);
  }

  async create(createUserDto: CreateUserDto): Promise<User> {
    try {
      if (!createUserDto) {
        throw new Error('Invalid user data');
      }

      const user = this.userRepository.create({
        ...createUserDto,
        password: await this.hashPassword(createUserDto.password),
      });
      return await this.userRepository.save(user);
    } catch (error) {
      // Handle or log the error as needed
      throw new Error(`Failed to create user: ${error.message}`);
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

  async findOneByEmail(email: string): Promise<User> {
    const user = await this.userRepository.findOneBy({ email });
    if (!user) {
      throw new NotFoundException(`User with email ${email} not found`);
    }
    return user;
  }

  async update(id: number, updateUserDto: UpdateUserDto) {
    const user = await this.findOne(id);
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    const data =
      updateUserDto.password != null
        ? {
            ...updateUserDto,
            password: await this.hashPassword(updateUserDto.password),
          }
        : updateUserDto;

    try {
      return this.userRepository.update(id, data);
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to update user: ${error.message}`,
      );
    }
  }

  async remove(id: number): Promise<void> {
    const user = await this.findOne(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    try {
      await this.userRepository.delete(id);
    } catch (error) {
      // Handle or log the error as needed
      throw new Error(`Failed to remove user: ${error.message}`);
    }
  }
}
