import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { sql } from 'drizzle-orm';
import { env, fromRoot, isProd, isTest } from './config/env';
import { logger } from './lib/logger';
import { db } from './db/client';
import { apiLimiter } from './middleware/rateLimit';
import { errorHandler, notFoundHandler } from './middleware/error';
import { authRouter } from './modules/auth/router';
import { metaRouter } from './modules/meta/router';
import { lookupsRouter } from './modules/lookups/router';
import { clientsRouter } from './modules/clients/router';
import { shipmentsRouter } from './modules/shipments/router';
import { cutStockRouter } from './modules/cutstock/router';
import { sealPlansRouter } from './modules/sealPlans/router';
import { coRouter } from './modules/co/router';
import { analyticsRouter, overviewRouter } from './modules/analytics/router';
import { accountingRouter } from './modules/accounting/router';
import { staffRouter } from './modules/staff/router';
import { settingsRouter } from './modules/settings/router';
import { followUpsRouter } from './modules/followups/router';
import { documentsRouter } from './modules/documents/router';
import { operationsRouter } from './modules/operations/router';
import { quotationsRouter } from './modules/quotations/router';
import { assistantRouter } from './modules/assistant/router';
import { searchRouter } from './modules/search/router';
import { chatRouter } from './modules/chat/router';
import { reportsRouter } from './modules/reports/router';
import { workflowRouter } from './modules/workflow/router';
import { buildOpenApiDocument } from './openapi/spec';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = (req.headers['x-request-id'] as string | undefined) ?? crypto.randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: !isTest,
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    }),
  );
  // On plain-HTTP office networks the browser must not be told to upgrade to HTTPS
  // (that breaks every request); HSTS and upgrade only when cookies are HTTPS-only.
  const https = env.COOKIE_SECURE;
  app.use(
    helmet({
      hsts: https,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: https ? [] : null,
        },
      },
    }),
  );
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  const v1 = express.Router();
  v1.use(apiLimiter);

  v1.get('/health', async (_req, res) => {
    await db.execute(sql`SELECT 1`);
    res.json({ status: 'ok', db: 'up' });
  });
  v1.use('/auth', authRouter);
  v1.use('/meta', metaRouter);
  v1.use('/lookups', lookupsRouter);
  v1.use('/clients', clientsRouter);
  v1.use('/shipments', shipmentsRouter);
  v1.use('/cut-stock', cutStockRouter);
  v1.use('/seal-plans', sealPlansRouter);
  v1.use('/co', coRouter);
  v1.use('/analytics', analyticsRouter);
  v1.use('/overview', overviewRouter);
  v1.use('/accounting', accountingRouter);
  v1.use('/staff', staffRouter);
  v1.use('/settings', settingsRouter);
  v1.use('/follow-ups', followUpsRouter);
  v1.use('/workflow', workflowRouter);
  v1.use('/documents', documentsRouter);
  v1.use('/operations', operationsRouter);
  v1.use('/quotations', quotationsRouter);
  v1.use('/assistant', assistantRouter);
  v1.use('/search', searchRouter);
  v1.use('/chat', chatRouter);
  v1.use('/reports', reportsRouter);

  app.use('/api/v1', v1);

  // API docs: Swagger UI needs inline scripts, so relax CSP for this path only.
  const openApiDoc = buildOpenApiDocument();
  app.get('/api/openapi.json', (_req, res) => res.json(openApiDoc));
  app.use(
    '/api/docs',
    helmet({ contentSecurityPolicy: false }),
    swaggerUi.serve,
    swaggerUi.setup(openApiDoc, { customSiteTitle: 'GS Command Center API' }),
  );

  // Production without nginx/Docker: serve the built website from this process.
  const webDir = env.WEB_DIST_DIR ? fromRoot(env.WEB_DIST_DIR) : null;
  if (webDir && fs.existsSync(path.join(webDir, 'index.html'))) {
    const indexHtml = path.join(webDir, 'index.html');
    app.use(
      '/assets',
      express.static(path.join(webDir, 'assets'), {
        immutable: true,
        maxAge: '365d',
        index: false,
      }),
    );
    app.use(
      '/fonts',
      express.static(path.join(webDir, 'fonts'), { immutable: true, maxAge: '365d', index: false }),
    );
    app.use(express.static(webDir, { index: false, maxAge: '1h' }));
    // Every non-API page (/plans, /accounting/…, /print/…) is the single-page app.
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
  } else if (webDir && isProd) {
    logger.warn({ webDir }, 'WEB_DIST_DIR is set but has no index.html — run "pnpm build" first');
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
