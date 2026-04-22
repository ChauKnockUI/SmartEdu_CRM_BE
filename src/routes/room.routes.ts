import { Router } from 'express';
import { roomController } from '../controllers/room.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();

// Tất cả các route đều cần đăng nhập
router.use(authenticate);

// Lấy danh sách phòng học (có phân trang, search, filter capacity, is_active)
router.get('/', roomController.getRooms);

// Lấy chi tiết phòng học
router.get('/:id', roomController.getRoomById);

// ─── Các API sửa đổi dữ liệu cần Role Admin ────────────────────────────────

// Tạo phòng học mới
router.post('/', authorize('admin'), roomController.createRoom);

// Cập nhật thông tin phòng học (bao gồm is_active, capacity)
router.put('/:id', authorize('admin'), roomController.updateRoom);

// Xóa phòng học (Soft delete) - Tùy chọn nếu cần thiết (PUT đã có thể làm việc này)
router.delete('/:id', authorize('admin'), roomController.deleteRoom);

export default router;
