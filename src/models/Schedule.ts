import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../database/db';

interface ScheduleAttributes {
  id: number; class_id?: number; teacher_id?: number; room_id?: number;
  date: string; start_time?: string; end_time?: string;
  status?: 'scheduled' | 'completed' | 'cancelled'; notes?: string;
}
interface ScheduleCreationAttributes extends Optional<ScheduleAttributes, 'id'> {}

class Schedule extends Model<ScheduleAttributes, ScheduleCreationAttributes> implements ScheduleAttributes {
  public id!: number; public class_id?: number; public teacher_id?: number;
  public room_id?: number; public date!: string; public start_time?: string;
  public end_time?: string; public status?: 'scheduled' | 'completed' | 'cancelled'; public notes?: string;
}
Schedule.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  class_id: { type: DataTypes.INTEGER }, teacher_id: { type: DataTypes.INTEGER },
  room_id: { type: DataTypes.INTEGER }, date: { type: DataTypes.DATEONLY, allowNull: false },
  start_time: { type: DataTypes.TIME }, end_time: { type: DataTypes.TIME },
  status: { type: DataTypes.ENUM('scheduled', 'completed', 'cancelled'), defaultValue: 'scheduled' },
  notes: { type: DataTypes.TEXT },
}, { sequelize, modelName: 'Schedule', tableName: 'Schedules' });
export default Schedule;