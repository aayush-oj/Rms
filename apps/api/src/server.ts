import { startServer } from './server/server';

startServer().catch((err) => {
  console.error('Fatal startup failure:', err);
  process.exit(1);
});
