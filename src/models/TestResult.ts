import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../database/db';

interface TestResultAttributes { id: number; test_id: number; student_id: number; score?: number; feedback?: string; }
interface TestResultCreationAttributes extends Optional<TestResultAttributes, 'id'> {}

class TestResult extends Model<TestResultAttributes, TestResultCreationAttributes> implements TestResultAttributes {
  public id!: number; public test_id!: number; public student_id!: number;
  public score?: number; public feedback?: string;
}
TestResult.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  test_id: { type: DataTypes.INTEGER, allowNull: false },
  student_id: { type: DataTypes.INTEGER, allowNull: false },
  score: { type: DataTypes.FLOAT }, feedback: { type: DataTypes.TEXT },
}, { sequelize, modelName: 'TestResult', tableName: 'TestResults' });
export default TestResult;