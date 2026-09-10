import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
export const IS_PUBLIC = 'isPublic';
export const ROLES_KEY = 'roles';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const Roles = (...roles:string[]) => SetMetadata(ROLES_KEY, roles);
export const CurrentUser = createParamDecorator((_data, ctx) => ctx.switchToHttp().getRequest().user);
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private reflector: Reflector) {}
  canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;
    const req = context.switchToHttp().getRequest();
    const raw = String(req.headers.authorization || '');
    const token = raw.startsWith('Bearer ') ? raw.slice(7) : '';
    if (!token) throw new UnauthorizedException('Token requerido');
    try { req.user = this.jwt.verify(token); return true; } catch { throw new UnauthorizedException('Sesión inválida o vencida'); }
  }
}
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector:Reflector){}
  canActivate(context:ExecutionContext){
    const required=this.reflector.getAllAndOverride<string[]>(ROLES_KEY,[context.getHandler(),context.getClass()])||[];
    if(!required.length)return true;
    const roles:string[]=context.switchToHttp().getRequest().user?.roles||[];
    if(required.some(r=>roles.includes(r)))return true;
    throw new ForbiddenException('No tienes permisos para este módulo');
  }
}
