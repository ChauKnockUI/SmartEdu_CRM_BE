import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../database/db';

interface TestAttributes { id: number; class_id: number; name: string; type: 'quiz' | 'midterm' | 'final' | 'assignment'; max_score?: number; test_date?: string; }
interface TestCreationAttributes extends Optional<TestAttributes, 'id'> {}

class Test extends Model<TestAttributes, TestCreationAttributes> implements TestAttributes {
  public id!: number; public class_id!: number; public name!: string;
  public type!: 'quiz' | 'midterm' | 'final' | 'assignment'; public max_score?: number; public test_date?: string;
}
Test.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  class_id: { type: DataTypes.INTEGER, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  type: { type: DataTypes.ENUM('quiz', 'midterm', 'final', 'assignment'), allowNull: false },
  max_score: { type: DataTypes.FLOAT }, test_date: { type: DataTypes.DATEONLY },
}, { sequelize, modelName: 'Test', tableName: 'Tests' });
export default Test;