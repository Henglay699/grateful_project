/**
 * PM2 process file (production, Windows or Linux):
 *   pm2 start ecosystem.config.cjs     pm2 logs gs-command-center     pm2 restart gs-command-center
 * Reads settings from .env in this folder.
 */
module.exports = {
  apps: [
    {
      name: 'gs-command-center',
      script: 'apps/api/dist/server.js',
      cwd: __dirname,
      node_args: '--env-file=.env',
      env: { NODE_ENV: 'production' },
      instances: 1,
      autorestart: true,
      max_memory_restart: '600M',
      out_file: 'logs/app.log',
      error_file: 'logs/error.log',
      time: true,
    },
  ],
};
