import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../database/db';

interface LeadActivityAttributes {
  id: number;
  lead_id: number;
  user_id?: number;
  type: 'call' | 'email' | 'sms' | 'meeting' | 'note' | 'status_change';
  content?: string;
}
interface LeadActivityCreationAttributes extends Optional<LeadActivityAttributes, 'id'> {}

class LeadActivity extends Model<LeadActivityAttributes, LeadActivityCreationAttributes> implements LeadActivityAttributes {
  public id!: number;
  public lead_id!: number;
  public user_id?: number;
  public type!: 'call' | 'email' | 'sms' | 'meeting' | 'note' | 'status_change';
  public content?: string;
}

LeadActivity.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  lead_id: { type: DataTypes.INTEGER, allowNull: false },
  user_id: { type: DataTypes.INTEGER },
  type: { type: DataTypes.ENUM('call', 'email', 'sms', 'meeting', 'note', 'status_change'), allowNull: false },
  content: { type: DataTypes.TEXT },
}, { sequelize, modelName: 'LeadActivity', tableName: 'LeadActivities' });

export default LeadActivity;