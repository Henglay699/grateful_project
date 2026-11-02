import type { ClientScopes, Permission, RoleCode } from '@gs/shared';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        role: RoleCode;
        permissions: Permission[];
        /** Clients this user may work with; null = every client. */
        clientIds: string[] | null;
        /** Sections with their own client access, replacing clientIds there. */
        clientScopes: ClientScopes;
      };
    }
  }
}
export {};
