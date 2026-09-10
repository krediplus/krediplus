import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from './prisma.service';

export const PERMISSIONS_KEY='permissions';
export const Permissions=(...permissions:string[])=>SetMetadata(PERMISSIONS_KEY,permissions);

export const ADMIN_PERMISSIONS:Record<string,string[]>= {
  SUPPORT:['VIEW_USERS','VIEW_ORDERS','VIEW_NOTIFICATIONS'],
  AUDITOR:['VIEW_USERS','VIEW_AUDIT','VIEW_PAYMENTS','VIEW_FINANCIALS','VIEW_ORDERS','VIEW_INVENTORY'],
  ANTIFRAUD:['VIEW_USERS','VIEW_PAYMENTS','REVIEW_PAYMENTS','VIEW_FRAUD_SIGNALS','VIEW_AUDIT'],
  ANALYST:['VIEW_USERS','REVIEW_USERS','VIEW_PAYMENTS','REVIEW_PAYMENTS','REVIEW_CREDITS','VIEW_ORDERS','MANAGE_ORDERS','VIEW_INVENTORY'],
  SUPERVISOR:['VIEW_USERS','REVIEW_USERS','VIEW_PAYMENTS','REVIEW_PAYMENTS','REVIEW_CREDITS','VIEW_ORDERS','MANAGE_ORDERS','VIEW_INVENTORY','MANAGE_CATALOG','MANAGE_PRICING','MANAGE_INVENTORY','APPROVE_SENSITIVE_ACTIONS','VIEW_AUDIT'],
  GENERAL:['FULL_ADMIN','VIEW_USERS','REVIEW_USERS','VIEW_PAYMENTS','REVIEW_PAYMENTS','REVIEW_CREDITS','VIEW_ORDERS','MANAGE_ORDERS','VIEW_INVENTORY','MANAGE_CATALOG','MANAGE_PRICING','MANAGE_INVENTORY','MANAGE_CREDIT_WALLET','MANAGE_ADMIN_ROLES','APPROVE_SENSITIVE_ACTIONS','VIEW_AUDIT','VIEW_FINANCIALS'],
};

export function permissionsForAdmin(subrole?:string|null){return new Set(ADMIN_PERMISSIONS[String(subrole||'GENERAL').toUpperCase()]||ADMIN_PERMISSIONS.GENERAL);}

@Injectable()
export class PermissionsGuard implements CanActivate{
  constructor(private readonly reflector:Reflector,private readonly db:PrismaService){}
  async canActivate(context:ExecutionContext){
    const required=this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY,[context.getHandler(),context.getClass()])||[];
    if(!required.length)return true;
    const req=context.switchToHttp().getRequest();const user=req.user;const roles:string[]=user?.roles||[];
    if(!roles.includes('ADMIN'))return true; // Los decoradores de esta versión se usan para subroles ADMIN.
    const row=await this.db.user.findUnique({where:{id:Number(user.sub)},select:{adminSubrole:true}});
    const granted=permissionsForAdmin(row?.adminSubrole);
    if(granted.has('FULL_ADMIN')||required.every(x=>granted.has(x)))return true;
    throw new ForbiddenException('Tu subrol administrativo no tiene permiso para esta acción');
  }
}
