import dotenv from 'dotenv';
dotenv.config();
console.log('Loaded .env:', process.env.DB_PASSWORD, process.env.DB_USER, process.env.DB_NAME);
import { Sequelize } from 'sequelize';

const sequelize = new Sequelize(
  'smartedu_crm',
  'postgres',
  '123456',
  {
    host: '127.0.0.1',
    dialect: 'postgres',
  }
);

async function connectDB() {
  try {
    await sequelize.authenticate();
    console.log('Database connection has been established successfully.');
  } catch (error) {
    console.error('Unable to connect to the database:', error);
    process.exit(1);
  }
}

export { connectDB, sequelize };
  } catch (error) {
    console.error('Unable to connect to the database:', error);
    process.exit(1);
  }
}

module.exports = { connectDB, sequelize };