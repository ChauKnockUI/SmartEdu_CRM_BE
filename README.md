# EduCRM Microservices Architecture

Hệ thống quản lý giáo dục EduCRM được xây dựng theo kiến trúc microservices với Node.js.

## 📁 Cấu trúc thư mục

```
microservices/
├── api-gateway/           # API Gateway (Port: 3000)
├── auth-service/          # Authentication Service (Port: 3001)
├── lms-service/           # Learning Management System (Port: 3002)
├── crm-service/           # Customer Relationship Management (Port: 3003)
├── finance-service/       # Finance & Payment Service (Port: 3004)
├── ai-service/            # AI & Analytics Service (Port: 3005)
├── notification-service/  # Notification Service (Port: 3006)
├── shared-libs/           # Shared Libraries & Common Code
└── docker-compose.yml     # Docker orchestration
```

## 🚀 Khởi chạy hệ thống

### 1. Cài đặt dependencies cho tất cả services

```bash
# Từ thư mục microservices
for service in */; do
  if [ -f "$service/package.json" ]; then
    echo "Installing dependencies for $service"
    cd $service && npm install && cd ..
  fi
done
```

### 2. Khởi chạy với Docker Compose

```bash
cd microservices
docker-compose up -d
```

### 2. Khởi tạo Database

```bash
# Khởi tạo databases
chmod +x init-databases.sh
./init-databases.sh

# Hoặc chạy thủ công
docker-compose exec postgres psql -U educrm -c "CREATE DATABASE educrm_auth;"
docker-compose exec postgres psql -U educrm -c "CREATE DATABASE educrm_lms;"
# ... tạo các database khác
```

### 3. Cấu hình Environment Variables

```bash
# Copy file cấu hình mẫu
cp .env.example .env

# Chỉnh sửa các biến môi trường theo nhu cầu
nano .env
```

### 4. Khởi chạy từng service riêng lẻ (Development)
cd microservices/lms-service && npm run dev

# Và tương tự cho các service khác...
```

## 📊 Services Overview

### 🔐 Auth Service (Port: 3001)
- **Chức năng**: Xác thực và phân quyền người dùng
- **Database**: PostgreSQL (`educrm_auth`)
- **Features**:
  - JWT Authentication
  - Role-Based Access Control (RBAC)
  - User Management
  - Password Reset

### 📚 LMS Service (Port: 3002)
- **Chức năng**: Quản lý học tập
- **Database**: PostgreSQL (`educrm_lms`)
- **Features**:
  - Quản lý lớp học
  - Điểm danh học viên
  - Lịch học
  - Quản lý giáo viên

### 👥 CRM Service (Port: 3003)
- **Chức năng**: Quản lý quan hệ khách hàng
- **Database**: PostgreSQL (`educrm_crm`)
- **Features**:
  - Quản lý leads
  - Tương tác khách hàng
  - Sales pipeline
  - Marketing campaigns

### 💰 Finance Service (Port: 3004)
- **Chức năng**: Quản lý tài chính
- **Database**: PostgreSQL (`educrm_finance`)
- **Features**:
  - Thanh toán học phí
  - Hóa đơn
  - Báo cáo tài chính
  - Theo dõi nợ

### 🤖 AI Service (Port: 3005)
- **Chức năng**: Phân tích và dự đoán
- **Database**: PostgreSQL (`educrm_ai`)
- **Features**:
  - Dự đoán churn rate
  - Phân tích lead scoring
  - Báo cáo AI insights

### 📢 Notification Service (Port: 3006)
- **Chức năng**: Gửi thông báo
- **Database**: PostgreSQL (`educrm_notifications`)
- **Features**:
  - Email notifications
  - SMS notifications
  - Push notifications
  - In-app notifications

## 🛠️ Development Tools

### Database Management
- **pgAdmin**: http://localhost:5050
  - Email: admin@educrm.com
  - Password: admin123

### Cache Management
- **Redis Commander**: http://localhost:8081

### API Documentation
- **API Gateway**: http://localhost:3000/api/docs

## 🔧 Environment Variables

Tạo file `.env` trong mỗi service với các biến môi trường cần thiết:

```env
NODE_ENV=development
DATABASE_URL=postgresql://educrm:password@localhost:5432/educrm_service
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-super-secret-jwt-key
```

## 📝 API Endpoints

### API Gateway Routes
```
GET  /api/health          # Health check
POST /api/auth/login      # User login
GET  /api/lms/classes     # Get classes
POST /api/crm/leads       # Create lead
GET  /api/finance/payments # Get payments
```

## 🧪 Testing

```bash
# Chạy tests cho tất cả services
npm test

# Chạy tests với watch mode
npm run test:watch
```

## 📚 Documentation

- [API Documentation](./docs/api.md)
- [Database Schema](./docs/database.md)
- [Deployment Guide](./docs/deployment.md)
- [Migration Guide](../MICROSERVICE_MIGRATION_GUIDE.md)

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](../LICENSE) file for details.