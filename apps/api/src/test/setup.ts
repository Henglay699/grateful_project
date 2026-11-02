import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Runs in every test worker before any app module is imported.
const envFile = path.resolve(__dirname, '../../../../.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
process.env.LOG_LEVEL = 'silent';
process.env.JWT_ACCESS_SECRET ??= 'test_secret_test_secret_test_secret_12345';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'gs-test-uploads');
