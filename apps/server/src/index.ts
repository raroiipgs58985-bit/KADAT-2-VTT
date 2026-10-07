import { createApp } from './app.js';

const app = createApp();
let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  try {
    await app.close();
  } catch (error) {
    console.error('Failed to close KADAT 2 server:', error);
    process.exit(1);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  const address = await app.listen({
    host: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.PORT ?? 3000),
  });
  console.log(`KADAT 2 server listening at ${address}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
