import 'dotenv/config'; // must be the first import so env vars exist before any other module reads them
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { connectDB, disconnectDB, getDbMode } from './config/db.js';
import { assertAuthConfigured } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import repositoryRoutes from './routes/repositoryRoutes.js';
import pathfinderRoutes from './routes/pathfinderRoutes.js';
import { RepositoryService } from './services/repositoryService.js';
import { cleanupOrphanAtlasFiles } from './services/atlas/atlasService.js';

const app = express();
const PORT = Number(process.env.PORT) || 5000;

app.disable('x-powered-by');

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(cors({ origin: allowedOrigins, credentials: true }));

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Only small JSON bodies are expected (a repo URL); ZIP uploads go through multer with their own limit.
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (_req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ok' : 'degraded',
    service: 'The Astral Cartographer Analysis Server',
    database: { connected: ready, mode: getDbMode(), durable: getDbMode() === 'persistent' },
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/repositories', repositoryRoutes);
app.use('/api/repositories', pathfinderRoutes);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

app.use(errorHandler);

async function startServer() {
  try {
    assertAuthConfigured();
    await connectDB();
    const recovered = await RepositoryService.recoverInterrupted();
    if (recovered) console.warn(`[Startup] Marked ${recovered} interrupted analysis run(s) as failed.`);
    cleanupOrphanAtlasFiles()
      .then((n) => { if (n) console.log(`[Startup] Removed ${n} orphaned dependency map file(s).`); })
      .catch((err) => console.warn('[Startup] Orphaned dependency map cleanup failed:', err?.message || err));
    const server = app.listen(PORT, () => console.log(`🌌 [Astral Server] Running on http://localhost:${PORT}`));
    server.requestTimeout = 5 * 60_000;
  } catch (err: any) {
    console.error('Failed to start server:', err.message || err);
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Process] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught Exception:', err);
});

process.on('SIGINT', async () => {
  console.log('[Process] Received SIGINT, shutting down gracefully...');
  await disconnectDB();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[Process] Received SIGTERM, shutting down gracefully...');
  await disconnectDB();
  process.exit(0);
});

startServer();
