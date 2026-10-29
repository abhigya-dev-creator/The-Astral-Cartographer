import mongoose from 'mongoose';

let memoryServer: { stop(): Promise<boolean> } | null = null;
let mode: 'persistent' | 'in-memory' | 'disconnected' = 'disconnected';

export const getDbMode = () => mode;

/** Never print credentials from a connection string. */
export function redactUri(uri: string): string {
  return uri.replace(/\/\/([^@/]+)@/, '//***:***@');
}

/**
 * Connection policy:
 *  - MONGODB_URI set        -> must connect, otherwise startup fails (data must not silently go to a throwaway DB).
 *                              Exception: ALLOW_IN_MEMORY_DB=true (explicit opt-in for local development).
 *  - MONGODB_URI not set    -> try a local MongoDB, then (development only) fall back to an embedded in-memory DB.
 * In-memory data is lost on every restart; `/api/health` reports which mode is active.
 */
export async function connectDB(): Promise<void> {
  const configured = process.env.MONGODB_URI;
  const uri = configured || 'mongodb://127.0.0.1:27017/astral_cartographer';
  const allowMemory = process.env.ALLOW_IN_MEMORY_DB === 'true' || (!configured && process.env.NODE_ENV !== 'production');

  // A configured database is retried a few times (network blips, a cluster waking up); the local default is tried once.
  const attempts = configured ? Math.max(1, Math.min(10, Number(process.env.DB_CONNECT_ATTEMPTS) || 4)) : 1;
  let delay = 2000;
  for (let attempt = 1; ; attempt++) {
    try {
      console.log(`[DB] Connecting to MongoDB at ${redactUri(uri)}${attempts > 1 ? ` (attempt ${attempt}/${attempts})` : ''} ...`);
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 4000 });
      mode = 'persistent';
      console.log('[DB] Connected to persistent MongoDB.');
      return;
    } catch (err: any) {
      if (attempt < attempts) {
        console.warn(`[DB] Connection failed (${err.message}). Retrying in ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 15000);
        continue;
      }
      if (!allowMemory) {
        throw new Error(`Could not connect to MongoDB (${err.message}). Check MONGODB_URI and that this computer's IP address is allowed (MongoDB Atlas → Network Access), or set ALLOW_IN_MEMORY_DB=true for throwaway local development.`);
      }
      console.warn(`[DB] Could not connect to MongoDB (${err.message}).`);
      break;
    }
  }

  console.warn('[DB] ⚠ Starting an embedded IN-MEMORY database. All analyses will be LOST when the server stops.');
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const server = await MongoMemoryServer.create({ instance: { dbName: 'astral_cartographer' } });
  memoryServer = server;
  await mongoose.connect(server.getUri());
  mode = 'in-memory';
  console.log('[DB] Connected to in-memory database.');
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
  mode = 'disconnected';
}
