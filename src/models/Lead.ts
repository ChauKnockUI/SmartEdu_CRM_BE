import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../database/db';

interface LeadAttributes {
  id: number;
  full_name: string;
  phone?: string;
  email?: string;
  source?: 'facebook' | 'zalo' | 'website' | 'referral' | 'walk_in' | 'other';
  status?: 'new' | 'contacted' | 'interested' | 'trial' | 'enrolled' | 'lost';
  ai_score?: number;
  ai_recommendation?: string;
  assigned_to?: number;
  notes?: string;
  last_contacted?: Date;
}
interface LeadCreationAttributes extends Optional<LeadAttributes, 'id'> {}

class Lead extends Model<LeadAttributes, LeadCreationAttributes> implements LeadAttributes {
  public id!: number;
  public full_name!: string;
  public phone?: string;
  public email?: string;
  public source?: 'facebook' | 'zalo' | 'website' | 'referral' | 'walk_in' | 'other';
  public status?: 'new' | 'contacted' | 'interested' | 'trial' | 'enrolled' | 'lost';
  public ai_score?: number;
  public ai_recommendation?: string;
  public assigned_to?: number;
  public notes?: string;
  public last_contacted?: Date;
}

Lead.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  full_name: { type: DataTypes.STRING, allowNull: false },
  phone: { type: DataTypes.STRING },
  email: { type: DataTypes.STRING },
  source: { type: DataTypes.ENUM('facebook', 'zalo', 'website', 'referral', 'walk_in', 'other'), defaultValue: 'other' },
  status: { type: DataTypes.ENUM('new', 'contacted', 'interested', 'trial', 'enrolled', 'lost'), defaultValue: 'new' },
  ai_score: { type: DataTypes.FLOAT },
  ai_recommendation: { type: DataTypes.TEXT },
  assigned_to: { type: DataTypes.INTEGER },
  notes: { type: DataTypes.TEXT },
  last_contacted: { type: DataTypes.DATE },
}, { sequelize, modelName: 'Lead', tableName: 'Leads' });

export default Lead;