import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../database/db';

interface PaymentAttributes {
  id: number; student_id: number; class_id?: number; amount: number;
  payment_date?: string; method?: 'cash' | 'bank_transfer' | 'momo' | 'vnpay' | 'other';
  status?: 'pending' | 'paid' | 'refunded'; notes?: string; created_by?: number;
}
interface PaymentCreationAttributes extends Optional<PaymentAttributes, 'id'> {}

class Payment extends Model<PaymentAttributes, PaymentCreationAttributes> implements PaymentAttributes {
  public id!: number; public student_id!: number; public class_id?: number;
  public amount!: number; public payment_date?: string;
  public method?: 'cash' | 'bank_transfer' | 'momo' | 'vnpay' | 'other';
  public status?: 'pending' | 'paid' | 'refunded'; public notes?: string; public created_by?: number;
}
Payment.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  student_id: { type: DataTypes.INTEGER, allowNull: false },
  class_id: { type: DataTypes.INTEGER },
  amount: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
  payment_date: { type: DataTypes.DATEONLY },
  method: { type: DataTypes.ENUM('cash', 'bank_transfer', 'momo', 'vnpay', 'other'), defaultValue: 'cash' },
  status: { type: DataTypes.ENUM('pending', 'paid', 'refunded'), defaultValue: 'pending' },
  notes: { type: DataTypes.TEXT }, created_by: { type: DataTypes.INTEGER },
}, { sequelize, modelName: 'Payment', tableName: 'Payments' });
export default Payment;