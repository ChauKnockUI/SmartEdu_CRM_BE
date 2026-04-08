import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../database/db';

interface CourseAttributes { id: number; name: string; description?: string; total_sessions?: number; fee?: number; duration_weeks?: number; }
interface CourseCreationAttributes extends Optional<CourseAttributes, 'id'> {}

class Course extends Model<CourseAttributes, CourseCreationAttributes> implements CourseAttributes {
  public id!: number; public name!: string; public description?: string;
  public total_sessions?: number; public fee?: number; public duration_weeks?: number;
}
Course.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT }, total_sessions: { type: DataTypes.INTEGER },
  fee: { type: DataTypes.DECIMAL(15, 2) }, duration_weeks: { type: DataTypes.INTEGER },
}, { sequelize, modelName: 'Course', tableName: 'Courses' });
export default Course;