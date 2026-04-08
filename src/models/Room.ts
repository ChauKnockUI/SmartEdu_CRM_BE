import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../database/db';

interface RoomAttributes { id: number; name: string; capacity?: number; equipment?: string; is_active: boolean; }
interface RoomCreationAttributes extends Optional<RoomAttributes, 'id' | 'is_active'> {}

class Room extends Model<RoomAttributes, RoomCreationAttributes> implements RoomAttributes {
  public id!: number; public name!: string; public capacity?: number;
  public equipment?: string; public is_active!: boolean;
}
Room.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  capacity: { type: DataTypes.INTEGER }, equipment: { type: DataTypes.TEXT },
  is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
}, { sequelize, modelName: 'Room', tableName: 'Rooms' });
export default Room;