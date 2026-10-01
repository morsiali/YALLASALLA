import { buildApp } from './http/app.js';
import { runMaintenance } from './services/jobs.js';

const { app, ctx } = await buildApp({ logger: true });
await app.listen({ port: ctx.cfg.port, host: '0.0.0.0' });
// Hourly maintenance (retention purge, loyalty expiry, stale unpaid orders). Use a real scheduler when running multiple instances.
setInterval(() => {
  runMaintenance(ctx).catch((e) => app.log.error({ err: e?.message }, 'maintenance failed'));
}, 3600_000).unref();
