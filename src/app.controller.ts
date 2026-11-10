import {
  Body,
  Controller,
  Request,
  Post,
  UseGuards,
  ClassSerializerInterceptor,
  UseInterceptors,
} from '@nestjs/common';
import { LocalAuthGuard } from './auth/local-auth.guard';
import { AuthService } from './auth/auth.service';
import { Public } from './decorators/public.decorator';
import { RegisterDto } from './auth/dto/register.dto';

@Controller()
export class AppController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @UseGuards(LocalAuthGuard)
  @Post('auth/login')
  async login(@Request() req: any) {
    return this.authService.login(req.user);
  }

  @Public()
  @UseInterceptors(ClassSerializerInterceptor)
  @Post('auth/register')
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.signUp(registerDto);
  }
}
