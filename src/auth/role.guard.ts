import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from 'src/types';
import { ROLES_KEY } from '../decorators/role.decorator';
import { User } from 'src/user/entities/user.entity';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) {
      return true;
    }
    const { user }: { user: Partial<User> } = context
      .switchToHttp()
      .getRequest();
    const userRole = user.isAdmin ? Role.ADMIN : Role.USER;
    return requiredRoles.some((role) => userRole === role);
  }
}
