import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../database/db';

interface ClassAttributes {
  id: number; name: string; course_id?: number; teacher_id?: number; room_id?: number;
  status?: 'upcoming' | 'ongoing' | 'completed' | 'cancelled';
  start_date?: string; end_date?: string; schedule_days?: string;
  schedule_time?: string; max_students?: number;
}
interface ClassCreationAttributes extends Optional<ClassAttributes, 'id'> {}

class Class extends Model<ClassAttributes, ClassCreationAttributes> implements ClassAttributes {
  public id!: number; public name!: string; public course_id?: number;
  public teacher_id?: number; public room_id?: number;
  public status?: 'upcoming' | 'ongoing' | 'completed' | 'cancelled';
  public start_date?: string; public end_date?: string;
  public schedule_days?: string; public schedule_time?: string; public max_students?: number;
}
Class.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  course_id: { type: DataTypes.INTEGER }, teacher_id: { type: DataTypes.INTEGER },
  room_id: { type: DataTypes.INTEGER },
  status: { type: DataTypes.ENUM('upcoming', 'ongoing', 'completed', 'cancelled'), defaultValue: 'upcoming' },
  start_date: { type: DataTypes.DATEONLY }, end_date: { type: DataTypes.DATEONLY },
  schedule_days: { type: DataTypes.STRING }, schedule_time: { type: DataTypes.STRING },
  max_students: { type: DataTypes.INTEGER },
}, { sequelize, modelName: 'Class', tableName: 'Classes' });
export default Class;