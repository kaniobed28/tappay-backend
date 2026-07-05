import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FirebaseAdminService } from './firebase-admin.service';
import { UsersService } from '../users/users.service';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Global guard. Verifies the `Authorization: Bearer <firebase-id-token>` header,
 * upserts the matching TapPay user, and attaches it to `request.user`.
 * Routes decorated with `@Public()` are skipped.
 */
@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly firebase: FirebaseAdminService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers['authorization'];
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice('Bearer '.length).trim();

    let identity;
    try {
      identity = await this.firebase.verifyToken(token);
    } catch (err) {
      throw new UnauthorizedException(`Invalid token: ${(err as Error).message}`);
    }

    const user = await this.users.upsertFromIdentity(identity);
    if (!user) throw new UnauthorizedException('User could not be resolved');

    request.user = user;
    return true;
  }
}
