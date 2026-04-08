import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../database/db';

interface StudentAttributes {
  id: number;
  user_id?: number;
  lead_id?: number;
  full_name: string;
  phone?: string;
  email?: string;
  dob?: string;
  status?: 'active' | 'inactive' | 'graduated' | 'dropped';
  enrollment_date?: string;
  dropout_risk?: number;
  dropout_risk_level?: 'low' | 'medium' | 'high';
}
interface StudentCreationAttributes extends Optional<StudentAttributes, 'id'> {}

class Student extends Model<StudentAttributes, StudentCreationAttributes> implements StudentAttributes {
  public id!: number;
  public user_id?: number;
  public lead_id?: number;
  public full_name!: string;
  public phone?: string;
  public email?: string;
  public dob?: string;
  public status?: 'active' | 'inactive' | 'graduated' | 'dropped';
  public enrollment_date?: string;
  public dropout_risk?: number;
  public dropout_risk_level?: 'low' | 'medium' | 'high';
}

Student.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  user_id: { type: DataTypes.INTEGER },
  lead_id: { type: DataTypes.INTEGER },
  full_name: { type: DataTypes.STRING, allowNull: false },
  phone: { type: DataTypes.STRING },
  email: { type: DataTypes.STRING },
  dob: { type: DataTypes.DATEONLY },
  status: { type: DataTypes.ENUM('active', 'inactive', 'graduated', 'dropped'), defaultValue: 'active' },
  enrollment_date: { type: DataTypes.DATEONLY },
  dropout_risk: { type: DataTypes.FLOAT },
  dropout_risk_level: { type: DataTypes.ENUM('low', 'medium', 'high') },
}, { sequelize, modelName: 'Student', tableName: 'Students' });

export default Student;