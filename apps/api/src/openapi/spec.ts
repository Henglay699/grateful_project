import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  ERROR_CODES,
  authResponseSchema,
  loginInputSchema,
  navCountsSchema,
  sessionUserSchema,
} from '@gs/shared';

extendZodWithOpenApi(z);

/**
 * OpenAPI 3.1 document generated from the same Zod schemas the API validates with.
 * Each phase registers its paths here.
 */
export const registry = new OpenAPIRegistry();

const bearer = registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

export const errorSchema = registry.register(
  'Error',
  z.object({
    error: z.object({
      code: z.enum(ERROR_CODES),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  }),
);

const errors = {
  400: {
    description: 'Validation error',
    content: { 'application/json': { schema: errorSchema } },
  },
  401: { description: 'Not signed in', content: { 'application/json': { schema: errorSchema } } },
  403: {
    description: 'Role lacks permission',
    content: { 'application/json': { schema: errorSchema } },
  },
  429: { description: 'Rate limited', content: { 'application/json': { schema: errorSchema } } },
};

registry.registerPath({
  method: 'get',
  path: '/health',
  tags: ['System'],
  summary: 'Liveness and database check',
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': { schema: z.object({ status: z.literal('ok'), db: z.literal('up') }) },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/login',
  tags: ['Auth'],
  summary: 'Sign in. Sets an httpOnly refresh cookie and returns a short-lived access token.',
  request: { body: { content: { 'application/json': { schema: loginInputSchema } } } },
  responses: {
    200: {
      description: 'Signed in',
      content: { 'application/json': { schema: authResponseSchema } },
    },
    400: errors[400],
    401: errors[401],
    429: errors[429],
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/refresh',
  tags: ['Auth'],
  summary: 'Rotate the refresh cookie and get a new access token',
  responses: {
    200: {
      description: 'Refreshed',
      content: { 'application/json': { schema: authResponseSchema } },
    },
    401: errors[401],
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/logout',
  tags: ['Auth'],
  summary: 'Revoke the session and clear the refresh cookie',
  responses: { 204: { description: 'Signed out' } },
});

registry.registerPath({
  method: 'get',
  path: '/auth/me',
  tags: ['Auth'],
  security: [{ [bearer.name]: [] }],
  summary: 'Current user, role and permissions',
  responses: {
    200: {
      description: 'Current user',
      content: { 'application/json': { schema: z.object({ user: sessionUserSchema }) } },
    },
    401: errors[401],
  },
});

registry.registerPath({
  method: 'get',
  path: '/meta/nav-counts',
  tags: ['Meta'],
  security: [{ [bearer.name]: [] }],
  summary: 'Badge counts for the sidebar and top bar',
  responses: {
    200: { description: 'Counts', content: { 'application/json': { schema: navCountsSchema } } },
    401: errors[401],
  },
});

export function buildOpenApiDocument() {
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: { title: 'Grateful Solutions — Logistics Command Center API', version: '1.0.0' },
    servers: [{ url: '/api/v1' }],
  });
}
