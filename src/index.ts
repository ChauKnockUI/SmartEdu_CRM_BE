import 'dotenv/config';
import { app } from './app';
import { connectDB, sequelize } from './database/db';
import './models/index';

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    await connectDB();

    await sequelize.sync({ alter: true }); // 🔥 tạo bảng
    console.log("✅ All tables created!");
    console.log(sequelize.models);

    app.listen(PORT, () => {
      console.log(`🚀 Server running at http://localhost:${PORT}`);
    });

  } catch (err) {
    console.error("❌ Error starting server:", err);
  }
};

startServer();