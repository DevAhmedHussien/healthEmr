import { createZodDto } from '@/shared/http/zod-dto';
import { acceptInviteSchema, loginSchema, refreshSchema } from '@health-emr/types';

export class LoginDto extends createZodDto(loginSchema) {}
export class RefreshDto extends createZodDto(refreshSchema) {}
export class AcceptInviteDto extends createZodDto(acceptInviteSchema) {}
