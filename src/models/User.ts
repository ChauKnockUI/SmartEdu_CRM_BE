import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../database/db';

interface UserAttributes {
  id: number;
  email: string;
  password_hash: string;
  full_name: string;
  phone?: string;
  role: 'admin' | 'staff' | 'teacher';
  avatar_url?: string;
  is_active: boolean;
}
interface UserCreationAttributes extends Optional<UserAttributes, 'id' | 'is_active'> {}

class User extends Model<UserAttributes, UserCreationAttributes> implements UserAttributes {
  public id!: number;
  public email!: string;
  public password_hash!: string;
  public full_name!: string;
  public phone?: string;
  public role!: 'admin' | 'staff' | 'teacher';
  public avatar_url?: string;
  public is_active!: boolean;
}

User.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  email: { type: DataTypes.STRING, allowNull: false, unique: true },
  password_hash: { type: DataTypes.STRING, allowNull: false },
  full_name: { type: DataTypes.STRING, allowNull: false },
  phone: { type: DataTypes.STRING },
  role: { type: DataTypes.ENUM('admin', 'staff', 'teacher'), allowNull: false, defaultValue: 'staff' },
  avatar_url: { type: DataTypes.STRING },
  is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
}, { sequelize, modelName: 'User', tableName: 'Users' });

export default User;