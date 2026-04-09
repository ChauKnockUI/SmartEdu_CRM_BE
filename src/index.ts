import 'dotenv/config';
import { app } from './app';
import { connectDB, disconnectDB } from './database/db';

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    await connectDB();

    const server = app.listen(PORT, () => {
      console.log(`🚀 Server running at http://localhost:${PORT}`);
      console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // ─── Graceful shutdown ──────────────────────────────────────────────────
    const shutdown = async (signal: string) => {
      console.log(`\n⚠️  ${signal} received — shutting down gracefully...`);
      server.close(async () => {
        await disconnectDB();
        console.log('✅ Database disconnected. Bye!');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (err) {
    console.error('❌ Error starting server:', err);
    process.exit(1);
  }
};

startServer();