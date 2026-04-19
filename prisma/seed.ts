import { PrismaClient, LeadActivityType, LeadAiRecommendation } from '../src/generated/prisma';

const prisma = new PrismaClient();

async function main() {
  console.log('Bắt đầu Seed Database...');

  // 1. Dọn dẹp dữ liệu cũ (Xóa theo thứ tự đảo ngược các Foreign Key)
  await prisma.aIPrediction.deleteMany({});
  await prisma.leadAiScore.deleteMany({});
  await prisma.leadActivity.deleteMany({});
  await prisma.lead.deleteMany({});
  await prisma.course.deleteMany({});
  await prisma.user.deleteMany({});

  // 2. Tạo User Sale Mẫu
  console.log('Tạo Data Users...');
  const saleUser = await prisma.user.create({
    data: {
      email: 'sale1@smartedu.com',
      password_hash: 'hash_gia_lap', // Mock
      full_name: 'Sale Thông Minh',
      phone: '0901234567',
      role: 'sale',
    },
  });

  // 3. Tạo Các Khóa học Mẫu
  console.log('Tạo Data Courses...');
  const courseIelts = await prisma.course.create({
    data: {
      name: 'IELTS 6.5 Intensive',
      total_sessions: 60,
      duration_weeks: 12
    }
  });

  const courseFrontend = await prisma.course.create({
    data: {
      name: 'Bootcamp Front-End React',
      total_sessions: 40,
      duration_weeks: 8
    }
  });

  // 4. Tạo Lead 1: Hot Lead (Có Điểm AI Cao)
  console.log('Tạo Data Leads & Activities...');
  const hotLead = await prisma.lead.create({
    data: {
      full_name: 'Nguyễn Văn Test Một',
      phone: '0987654321',
      email: 'nguyenvantes1@gmail.com',
      lead_source: 'facebook',
      occupation: 'student_y3_y4',
      study_purpose: 'study_abroad',
      course_id: courseIelts.id,
      assigned_to: saleUser.id,
      status: 'interested',
      createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) // Tạo cách đây 5 ngày
    }
  });

  // Mock Activity cho Hot Lead
  await prisma.leadActivity.createMany({
    data: [
      {
        lead_id: hotLead.id,
        user_id: saleUser.id,
        type: LeadActivityType.call,
        engagement_status: 'busy_call_back',
        content: 'Gọi hỏi thăm lộ trình',
        createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)
      },
      {
        lead_id: hotLead.id,
        user_id: saleUser.id,
        type: LeadActivityType.call,
        engagement_status: 'connected',
        content: 'Tư vấn chuyên sâu Ielts, khách xin báo giá',
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      }
    ]
  });

  // Lên Điểm Mock cho Hot Lead
  await prisma.leadAiScore.create({
    data: {
      lead_id: hotLead.id,
      probability_score: 95.5,
      recommendation: LeadAiRecommendation.HOT_LEAD,
      positive_factors: ["Nguồn kênh chuyển đổi cao", "Học sinh năm 3,4"],
      negative_factors: []
    }
  });

  // 5. Tạo Lead 2: Cold Lead (Chưa gán AI Score hoặc Điểm Thấp)
  const coldLead = await prisma.lead.create({
    data: {
      full_name: 'Trần Thị Nháp Hai',
      phone: '0912344321',
      email: 'tranthinhap2@gmail.com',
      lead_source: 'zalo',
      occupation: 'unemployed',
      study_purpose: 'hobby',
      course_id: courseFrontend.id,
      assigned_to: saleUser.id,
      status: 'new',
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    }
  });

  // Activity thưa thớt cho Cold Lead
  await prisma.leadActivity.create({
    data: {
      lead_id: coldLead.id,
      user_id: saleUser.id,
      type: LeadActivityType.call,
      engagement_status: 'wrong_number',
      content: 'Nhầm số, không nghe máy',
      createdAt: new Date()
    }
  });

  await prisma.leadAiScore.create({
    data: {
      lead_id: coldLead.id,
      probability_score: 12.0,
      recommendation: LeadAiRecommendation.COLD_LEAD,
      positive_factors: [],
      negative_factors: ["Sai số điện thoại", "Chưa có nhu cầu rõ ràng"]
    }
  });

  // 6. Tạo Lead 3: Chưa hề có thông tin Activity, Chưa gọi AI Score
  const newLead = await prisma.lead.create({
    data: {
      full_name: 'Lê Văn Trắng',
      phone: '0933222111',
      lead_source: 'website',
      status: 'new',
      course_id: courseFrontend.id,
      createdAt: new Date()
    }
  });

  console.log('Seed Data thành công!');
  console.log('- Đã tạo 1 Account Sales');
  console.log('- Đã tạo 2 Courses');
  console.log('- Đã tạo 3 Leads mẫu (Hot, Cold, và Chưa chấm điểm)');
}

main()
  .catch((e) => {
    console.error('Lỗi khi chạy Seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
