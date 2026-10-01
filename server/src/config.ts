import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
loadEnv({ path: path.join(root, '.env') });

const DEV_SECRET_MARK = 'change-me-dev-only';
const env = (k: string, d: string) => process.env[k] ?? d;

export type ProviderMode = 'mock' | 'sandbox' | 'live';

export interface Config {
  nodeEnv: string;
  port: number;
  webOrigin: string;
  databaseUrl: string;
  appDatabaseUrl: string;
  serviceDatabaseUrl: string;
  appDbPassword: string;
  serviceDbPassword: string;
  authSecret: string;
  mediaSecret: string;
  webhookSecret: string;
  otpProvider: 'mock';
  paymentProvider: 'sandbox';
  aiProvider: 'rules' | 'anthropic';
  transcriptionProvider: 'mock';
  storageDir: string;
  anthropicKey: string;
  anthropicModel: string;
  codEnabled: boolean;
  autoSubMaxIncreasePct: number;
  rootDir: string;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const c: Config = {
    nodeEnv: env('NODE_ENV', 'development'),
    port: Number(env('PORT', '4000')),
    webOrigin: env('PUBLIC_WEB_ORIGIN', 'http://localhost:5173'),
    databaseUrl: env('DATABASE_URL', 'postgres://yalasala_owner:owner_dev_pw@localhost:54329/yalasala'),
    appDatabaseUrl: env('APP_DATABASE_URL', 'postgres://yalasala_app:app_dev_pw@localhost:54329/yalasala'),
    serviceDatabaseUrl: env('SERVICE_DATABASE_URL', 'postgres://yalasala_service:service_dev_pw@localhost:54329/yalasala'),
    appDbPassword: env('APP_DB_PASSWORD', 'app_dev_pw'),
    serviceDbPassword: env('SERVICE_DB_PASSWORD', 'service_dev_pw'),
    authSecret: env('AUTH_SECRET', `${DEV_SECRET_MARK}-auth-secret-0123456789`),
    mediaSecret: env('MEDIA_SIGNING_SECRET', `${DEV_SECRET_MARK}-media-secret-0123456789`),
    webhookSecret: env('PAYMENT_WEBHOOK_SECRET', `${DEV_SECRET_MARK}-webhook-secret`),
    otpProvider: 'mock',
    paymentProvider: 'sandbox',
    aiProvider: env('AI_PROVIDER', 'rules') === 'anthropic' ? 'anthropic' : 'rules',
    transcriptionProvider: 'mock',
    storageDir: path.resolve(root, env('STORAGE_DIR', './storage')),
    anthropicKey: env('ANTHROPIC_API_KEY', ''),
    anthropicModel: env('ANTHROPIC_MODEL', 'claude-sonnet-5-5'),
    codEnabled: env('CASH_ON_DELIVERY_ENABLED', 'true') === 'true',
    autoSubMaxIncreasePct: Number(env('AUTO_SUBSTITUTION_MAX_INCREASE_PCT', '15')),
    rootDir: root,
    ...overrides,
  };
  if (c.nodeEnv === 'production') {
    for (const [k, v] of Object.entries({ AUTH_SECRET: c.authSecret, MEDIA_SIGNING_SECRET: c.mediaSecret, PAYMENT_WEBHOOK_SECRET: c.webhookSecret })) {
      if (v.includes(DEV_SECRET_MARK) || v.length < 32) throw new Error(`${k} must be set to a strong secret in production`);
    }
    if (c.otpProvider === 'mock') throw new Error('OTP_PROVIDER=mock is not allowed in production: implement a live SMS adapter (docs/PROVIDERS.md)');
  }
  return c;
}
