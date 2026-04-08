import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../database/db';

interface TeacherAttributes {
  id: number; user_id?: number; full_name: string; phone?: string;
  email?: string; type?: 'full_time' | 'part_time';
  specialization?: string; is_active: boolean;
}
interface TeacherCreationAttributes extends Optional<TeacherAttributes, 'id' | 'is_active'> {}

class Teacher extends Model<TeacherAttributes, TeacherCreationAttributes> implements TeacherAttributes {
  public id!: number; public user_id?: number; public full_name!: string;
  public phone?: string; public email?: string;
  public type?: 'full_time' | 'part_time'; public specialization?: string; public is_active!: boolean;
}

Teacher.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  user_id: { type: DataTypes.INTEGER },
  full_name: { type: DataTypes.STRING, allowNull: false },
  phone: { type: DataTypes.STRING }, email: { type: DataTypes.STRING },
  type: { type: DataTypes.ENUM('full_time', 'part_time'), defaultValue: 'full_time' },
  specialization: { type: DataTypes.STRING },
  is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
}, { sequelize, modelName: 'Teacher', tableName: 'Teachers' });
export default Teacher;