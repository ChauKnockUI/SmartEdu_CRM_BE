import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../database/db';

interface AIPredictionAttributes {
  id: number; prediction_type: 'lead_score' | 'dropout_risk' | 'revenue_forecast';
  reference_id?: number; input_data?: object; result_data?: object;
}
interface AIPredictionCreationAttributes extends Optional<AIPredictionAttributes, 'id'> {}

class AIPrediction extends Model<AIPredictionAttributes, AIPredictionCreationAttributes> implements AIPredictionAttributes {
  public id!: number; public prediction_type!: 'lead_score' | 'dropout_risk' | 'revenue_forecast';
  public reference_id?: number; public input_data?: object; public result_data?: object;
}
AIPrediction.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  prediction_type: { type: DataTypes.ENUM('lead_score', 'dropout_risk', 'revenue_forecast'), allowNull: false },
  reference_id: { type: DataTypes.INTEGER },
  input_data: { type: DataTypes.JSONB }, result_data: { type: DataTypes.JSONB },
}, { sequelize, modelName: 'AIPrediction', tableName: 'AIPredictions' });
export default AIPrediction;