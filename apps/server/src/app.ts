import Fastify from 'fastify';

export function createApp() {
  const app = Fastify();

  app.get('/health', () => ({ status: 'ok' }));

  return app;
}
