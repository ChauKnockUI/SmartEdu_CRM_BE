import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../database/db';

interface ClassEnrollmentAttributes { id: number; class_id: number; student_id: number; status?: 'active' | 'dropped' | 'completed'; }
interface ClassEnrollmentCreationAttributes extends Optional<ClassEnrollmentAttributes, 'id'> {}

class ClassEnrollment extends Model<ClassEnrollmentAttributes, ClassEnrollmentCreationAttributes> implements ClassEnrollmentAttributes {
  public id!: number; public class_id!: number; public student_id!: number;
  public status?: 'active' | 'dropped' | 'completed';
}
ClassEnrollment.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  class_id: { type: DataTypes.INTEGER, allowNull: false },
  student_id: { type: DataTypes.INTEGER, allowNull: false },
  status: { type: DataTypes.ENUM('active', 'dropped', 'completed'), defaultValue: 'active' },
}, { sequelize, modelName: 'ClassEnrollment', tableName: 'ClassEnrollments' });
export default ClassEnrollment;