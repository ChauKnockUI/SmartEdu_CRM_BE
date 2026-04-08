import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../database/db';

interface AttendanceAttributes { id: number; schedule_id: number; student_id: number; status: 'present' | 'absent' | 'late' | 'excused'; notes?: string; }
interface AttendanceCreationAttributes extends Optional<AttendanceAttributes, 'id'> {}

class Attendance extends Model<AttendanceAttributes, AttendanceCreationAttributes> implements AttendanceAttributes {
  public id!: number; public schedule_id!: number; public student_id!: number;
  public status!: 'present' | 'absent' | 'late' | 'excused'; public notes?: string;
}
Attendance.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  schedule_id: { type: DataTypes.INTEGER, allowNull: false },
  student_id: { type: DataTypes.INTEGER, allowNull: false },
  status: { type: DataTypes.ENUM('present', 'absent', 'late', 'excused'), allowNull: false, defaultValue: 'present' },
  notes: { type: DataTypes.TEXT },
}, { sequelize, modelName: 'Attendance', tableName: 'Attendances' });
export default Attendance;