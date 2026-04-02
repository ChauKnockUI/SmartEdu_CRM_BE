# Database Schema cho EduCRM Microservices

## 🗄️ Database per Service Pattern

Mỗi microservice có database riêng để đảm bảo:
- **Data Isolation**: Dữ liệu được cô lập giữa các services
- **Independent Scaling**: Mỗi service có thể scale DB riêng
- **Technology Diversity**: Mỗi service có thể dùng DB engine khác nhau
- **Schema Evolution**: Thay đổi schema không ảnh hưởng service khác

## 📊 Database Mapping

| Service | Database | Schema | Mục đích |
|---------|----------|--------|----------|
| **Auth Service** | `educrm_auth` | users, roles, permissions | Xác thực & phân quyền |
| **LMS Service** | `educrm_lms` | classes, sessions, students, teachers | Quản lý học tập |
| **CRM Service** | `educrm_crm` | leads, interactions, campaigns | Quản lý khách hàng |
| **Finance Service** | `educrm_finance` | payments, invoices, transactions | Quản lý tài chính |
| **AI Service** | `educrm_ai` | models, predictions, analytics | AI & phân tích |
| **Notification Service** | `educrm_notifications` | notifications, templates, logs | Thông báo |

## 🏗️ Database Structure

### Auth Database (`educrm_auth`)
```sql
-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  status VARCHAR(50) DEFAULT 'active',
  role_id UUID REFERENCES roles(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Roles table
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  permissions JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### LMS Database (`educrm_lms`)
```sql
-- Classes table
CREATE TABLE classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  teacher_id UUID REFERENCES teachers(id),
  status VARCHAR(50) DEFAULT 'active',
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Sessions table
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID REFERENCES classes(id),
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  topic TEXT,
  status VARCHAR(50) DEFAULT 'scheduled',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

## 🔧 Connection Strings

### Development (Docker)
```env
# Auth Service
DATABASE_URL=postgresql://educrm:password@postgres:5432/educrm_auth

# LMS Service
DATABASE_URL=postgresql://educrm:password@postgres:5432/educrm_lms

# CRM Service
DATABASE_URL=postgresql://educrm:password@postgres:5432/educrm_crm

# Finance Service
DATABASE_URL=postgresql://educrm:password@postgres:5432/educrm_finance

# AI Service
DATABASE_URL=postgresql://educrm:password@postgres:5432/educrm_ai

# Notification Service
DATABASE_URL=postgresql://educrm:password@postgres:5432/educrm_notifications
```

### Production (AWS RDS)
```env
DATABASE_URL=postgresql://username:password@educrm-db.cluster-xyz.us-east-1.rds.amazonaws.com:5432/service_db
```

## 🚀 Migration Strategy

### 1. Initial Setup
```bash
# Tạo databases
createdb educrm_auth
createdb educrm_lms
createdb educrm_crm
createdb educrm_finance
createdb educrm_ai
createdb educrm_notifications
```

### 2. Run Migrations per Service
```bash
# Auth Service
cd microservices/auth-service
npm run migrate

# LMS Service
cd microservices/lms-service
npm run migrate

# Tương tự cho các service khác...
```

### 3. Seed Data (Optional)
```bash
# Import initial data
psql -d educrm_auth -f seeds/auth-seeds.sql
psql -d educrm_lms -f seeds/lms-seeds.sql
```

## 📈 Monitoring & Backup

### Health Checks
- Connection pool monitoring
- Query performance tracking
- Database size monitoring

### Backup Strategy
- Daily automated backups
- Point-in-time recovery
- Cross-region replication

### Performance
- Read replicas for high-traffic services
- Connection pooling
- Query optimization
- Indexing strategy

## 🔒 Security

- **SSL/TLS encryption** for all connections
- **Database user isolation** per service
- **Row Level Security (RLS)** for multi-tenant data
- **Audit logging** for sensitive operations
- **Encryption at rest** for sensitive data

## 📚 Best Practices

1. **Use UUIDs** for primary keys (avoid conflicts)
2. **Implement soft deletes** with `deleted_at` column
3. **Add audit fields** (`created_at`, `updated_at`, `created_by`)
4. **Use database transactions** for complex operations
5. **Implement database constraints** and validations
6. **Regular backup testing** and disaster recovery drills