import User from './User';
import Lead from './Lead';
import LeadActivity from './LeadActivity';
import Student from './Student';
import Teacher from './Teacher';
import Room from './Room';
import Course from './Course';
import Class from './Class';
import ClassEnrollment from './ClassEnrollment';
import Schedule from './Schedule';
import Attendance from './Attendance';
import Test from './Test';
import TestResult from './TestResult';
import Payment from './Payment';
import AIPrediction from './AIPrediction';

// User associations
User.hasMany(Lead, { foreignKey: 'assigned_to', as: 'assignedLeads' });
User.hasMany(LeadActivity, { foreignKey: 'user_id', as: 'leadActivities' });
User.hasOne(Student, { foreignKey: 'user_id' });
User.hasOne(Teacher, { foreignKey: 'user_id' });
User.hasMany(Payment, { foreignKey: 'created_by', as: 'createdPayments' });

// Lead associations
Lead.belongsTo(User, { foreignKey: 'assigned_to', as: 'assignedUser' });
Lead.hasMany(LeadActivity, { foreignKey: 'lead_id', as: 'activities' });
Lead.hasOne(Student, { foreignKey: 'lead_id' });

// LeadActivity associations
LeadActivity.belongsTo(Lead, { foreignKey: 'lead_id' });
LeadActivity.belongsTo(User, { foreignKey: 'user_id' });

// Student associations
Student.belongsTo(User, { foreignKey: 'user_id' });
Student.belongsTo(Lead, { foreignKey: 'lead_id' });
Student.hasMany(ClassEnrollment, { foreignKey: 'student_id' });
Student.belongsToMany(Class, { through: ClassEnrollment, foreignKey: 'student_id' });
Student.hasMany(Attendance, { foreignKey: 'student_id' });
Student.hasMany(TestResult, { foreignKey: 'student_id' });
Student.hasMany(Payment, { foreignKey: 'student_id' });

// Teacher associations
Teacher.belongsTo(User, { foreignKey: 'user_id' });
Teacher.hasMany(Class, { foreignKey: 'teacher_id' });
Teacher.hasMany(Schedule, { foreignKey: 'teacher_id' });

// Room associations
Room.hasMany(Class, { foreignKey: 'room_id' });
Room.hasMany(Schedule, { foreignKey: 'room_id' });

// Course associations
Course.hasMany(Class, { foreignKey: 'course_id' });

// Class associations
Class.belongsTo(Course, { foreignKey: 'course_id' });
Class.belongsTo(Teacher, { foreignKey: 'teacher_id' });
Class.belongsTo(Room, { foreignKey: 'room_id' });
Class.hasMany(ClassEnrollment, { foreignKey: 'class_id' });
Class.belongsToMany(Student, { through: ClassEnrollment, foreignKey: 'class_id' });
Class.hasMany(Schedule, { foreignKey: 'class_id' });
Class.hasMany(Test, { foreignKey: 'class_id' });
Class.hasMany(Payment, { foreignKey: 'class_id' });

// ClassEnrollment associations
ClassEnrollment.belongsTo(Class, { foreignKey: 'class_id' });
ClassEnrollment.belongsTo(Student, { foreignKey: 'student_id' });

// Schedule associations
Schedule.belongsTo(Class, { foreignKey: 'class_id' });
Schedule.belongsTo(Teacher, { foreignKey: 'teacher_id' });
Schedule.belongsTo(Room, { foreignKey: 'room_id' });
Schedule.hasMany(Attendance, { foreignKey: 'schedule_id' });

// Attendance associations
Attendance.belongsTo(Schedule, { foreignKey: 'schedule_id' });
Attendance.belongsTo(Student, { foreignKey: 'student_id' });

// Test associations
Test.belongsTo(Class, { foreignKey: 'class_id' });
Test.hasMany(TestResult, { foreignKey: 'test_id' });

// TestResult associations
TestResult.belongsTo(Test, { foreignKey: 'test_id' });
TestResult.belongsTo(Student, { foreignKey: 'student_id' });

// Payment associations
Payment.belongsTo(Student, { foreignKey: 'student_id' });
Payment.belongsTo(Class, { foreignKey: 'class_id' });
Payment.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });

export {
  User, Lead, LeadActivity, Student, Teacher, Room, Course,
  Class, ClassEnrollment, Schedule, Attendance, Test, TestResult,
  Payment, AIPrediction,
};