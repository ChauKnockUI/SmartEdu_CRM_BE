import { Prisma, PredictionType } from '../../generated/prisma';
import { prisma, withTenantTx } from '../../database/db';
import { currentTenantId } from '../../database/tenant-context';
import { dropoutRiskApi } from './dropoutRisk.api';
import { academicSnapshot, attendanceRule, combinedRisk, HYBRID_VERSION, MAPPING_VERSION, normalizeScore, storedDay, vietnamDay } from './dropoutRisk.policy';

const json = (value: unknown) => value as Prisma.InputJsonValue;

export class DropoutRiskService {
  async assertScoringAccess(classId: number, userId: number, role: string) {
    if (!['admin', 'sale', 'teacher'].includes(role)) throw Object.assign(new Error('Không có quyền đánh giá'), { statusCode: 403 });
    if (role === 'teacher') {
      const owned = await prisma.class.findFirst({ where: { id: classId, teacher: { user_id: userId } }, select: { id: true } });
      if (!owned) throw Object.assign(new Error('Chỉ được đánh giá lớp được phân công'), { statusCode: 403 });
    }
  }

  async scoreStudent(studentId: number, classId: number) {
    const now = new Date();
    const today = vietnamDay(now);
    const classData = await prisma.class.findUnique({
      where: { id: classId },
      include: {
        course: { select: { total_sessions: true } },
        teacher: { select: { user_id: true } },
        classEnrollments: { where: { student_id: studentId }, include: { student: { select: { full_name: true } } } },
        schedules: {
          where: { status: { not: 'cancelled' } }, orderBy: { date: 'asc' },
          include: { attendances: { where: { student_id: studentId }, select: { status: true } } },
        },
        assignments: { include: { submissions: { where: { student_id: studentId } } } },
        tests: { include: { testResults: { where: { student_id: studentId } } } },
        invoices: { where: { student_id: studentId }, include: { payments: true } },
      },
    });
    if (!classData) throw Object.assign(new Error('Không tìm thấy lớp học'), { statusCode: 404 });
    const enrollment = classData.classEnrollments[0];
    if (!enrollment) throw Object.assign(new Error('Học viên chưa ghi danh vào lớp'), { statusCode: 400 });
    if (enrollment.status !== 'active' || classData.status !== 'ongoing') {
      return { success: true, skipped: true, reason: 'Chỉ theo dõi học viên đang học trong lớp đang diễn ra.' };
    }
    const held = classData.schedules.filter(s => s.status === 'completed' || storedDay(s.date) < today
      || (storedDay(s.date) === today && s.attendances.length > 0));
    const planned = Math.max(classData.course?.total_sessions || 0, classData.schedules.length);
    const passScore = Number(process.env.DROPOUT_PASS_SCORE || 5);
    if (!Number.isFinite(passScore) || passScore <= 0 || passScore > 10) throw new Error('Invalid DROPOUT_PASS_SCORE');
    const scores: Array<number | null> = [];
    for (const test of classData.tests) {
      if (!test.test_date || storedDay(test.test_date) > today || test.createdAt > now) continue;
      scores.push(normalizeScore(test.testResults[0]?.score, test.max_score));
    }
    for (const assignment of classData.assignments) {
      if (assignment.createdAt > now) continue;
      const submission = assignment.submissions[0];
      if (submission?.status === 'excused') continue;
      const submitted = submission?.submitted_at && submission.submitted_at <= now
        && ['submitted', 'late'].includes(submission.status);
      const grade = submitted ? normalizeScore(submission.score, assignment.max_score) : null;
      const due = assignment.due_date && storedDay(assignment.due_date) < today;
      // A grade already available is usable even before the submission deadline.
      if (due || grade !== null) scores.push(grade);
    }
    const snapshot = academicSnapshot(scores, held.length, planned, passScore);
    const attendance = attendanceRule(held.map(s => s.attendances[0]?.status || null));
    const overdue = classData.invoices.filter(invoice => {
      if (!invoice.due_date || storedDay(invoice.due_date) >= today || !['pending', 'partial', 'overdue'].includes(invoice.status)) return false;
      const remaining = Number(invoice.total_amount) - Number(invoice.discount_amount)
        - invoice.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
      return remaining > 0;
    });
    const prediction = snapshot.eligible ? await dropoutRiskApi.fetchPrediction(snapshot.features) : null;
    const modelFlagged = prediction?.model_flagged === true;
    const overdueDays = overdue.reduce((maximum, invoice) => Math.max(maximum,
      Math.round((Date.parse(today) - Date.parse(storedDay(invoice.due_date!))) / 86_400_000)), 0);
    const tuitionKnown = classData.invoices.some(invoice => !['cancelled', 'refunded'].includes(invoice.status)
      && (invoice.due_date !== null || invoice.status === 'paid'));
    const paidLateDays = classData.invoices.reduce((maximum, invoice) => {
      if (!invoice.due_date || ['cancelled', 'refunded'].includes(invoice.status)) return maximum;
      return invoice.payments.reduce((days, payment) => !payment.paid_at || payment.paid_at > now ? days
        : Math.max(days, Math.round((Date.parse(vietnamDay(payment.paid_at))
          - Date.parse(storedDay(invoice.due_date!))) / 86_400_000)), maximum);
    }, 0);
    const hybrid = combinedRisk({ academic: prediction?.risk_score ?? null, modelFlagged,
      attendance, tuitionKnown, overdueDays });
    const level = hybrid.level;
    const reasons: string[] = [];
    if (modelFlagged) reasons.push(`[Model học tập] Điểm rủi ro vượt ngưỡng theo dõi. Dữ liệu: đạt ${Math.round(snapshot.features.Pass_Rate * 100)}%, chưa được đánh giá ${Math.round(snapshot.features.Not_Evaluated_Rate * 100)}%. Cần liên hệ để tìm hiểu khó khăn.`);
    if (attendance.flagged) reasons.push(`[Chuyên cần] Vắng không phép ${attendance.absent} buổi, liên tiếp ${attendance.consecutive} buổi.`);
    if (overdue.length) reasons.push(`[Học phí] Có ${overdue.length} khoản còn dư nợ, quá hạn tối đa ${overdueDays} ngày.`);
    if (!snapshot.eligible) reasons.push('[Dữ liệu] Chưa có điểm học tập; phần AI được bỏ khỏi phép tính.');
    else if (!prediction) reasons.push('Model tạm không sẵn sàng; các quy tắc chuyên cần và học phí vẫn được kiểm tra.');
    else if (!modelFlagged) reasons.push('Model học tập chưa vượt ngưỡng theo dõi.');
    if (prediction && snapshot.limited_data) reasons.push('Ước tính sớm: mới có một bài được chấm, cần tiếp tục cập nhật.');
    if (hybrid.score !== null) reasons.unshift(`[Tổng hợp] ${hybrid.score}/100 điểm rủi ro từ ${hybrid.available_components}/3 nhóm thông tin.`);
    else reasons.push('Chưa có dữ liệu học tập, điểm danh hoặc hóa đơn đủ để tính điểm tổng hợp.');
    const action = level === 'high' ? 'Liên hệ học viên để tìm hiểu khó khăn, tư vấn hoặc thống nhất phương án hỗ trợ.'
      : level === 'medium' ? 'Kiểm tra căn cứ cảnh báo và trao đổi với học viên để hỗ trợ sớm.' : 'Tiếp tục theo dõi và bổ sung dữ liệu còn thiếu.';
    const result = {
      class_id: classId, mapping_version: MAPPING_VERSION, model: prediction,
      model_status: !snapshot.eligible ? 'not_eligible' : prediction ? 'scored' : 'unavailable',
      risk_level: level, risk_score: hybrid.score, score_type: hybrid.score_type, hybrid,
      academic_score: prediction?.risk_score ?? null, top_reasons: reasons, action,
      evidence: {
        attendance: { attended: attendance.attended, recorded: attendance.recorded,
          absent: attendance.absent, consecutive: attendance.consecutive },
        tuition: { overdue_days: overdueDays, overdue_count: overdue.length, paid_late_days: paidLateDays },
        academic: { flagged: modelFlagged, passed: Math.round(snapshot.features.Pass_Rate * scores.length),
          assessed: scores.length, scored: snapshot.scored_assessments },
      },
      evaluated_at: now.toISOString(),
      rules: { attendance, overdue_invoice_ids: overdue.map(i => i.id) }, snapshot,
    };
    // Serialize a student's concurrent class updates and notification deduplication.
    const tenantId = currentTenantId();
    const notificationCount = await withTenantTx(async tx => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${tenantId}::int, ${studentId}::int)`);
      await tx.aIPrediction.create({ data: {
        prediction_type: PredictionType.dropout_risk, reference_id: studentId,
        input_data: json({ ...snapshot, pass_score: passScore, mapping_version: MAPPING_VERSION }), result_data: json(result),
      } });
      // Student summary reflects latest snapshots of all active classes, not the last class scored.
      const active = await tx.classEnrollment.findMany({
        where: { student_id: studentId, status: 'active', class: { status: 'ongoing' } }, select: { class_id: true },
      });
      const latest = await Promise.all(active.map(item => tx.aIPrediction.findFirst({
        where: { prediction_type: PredictionType.dropout_risk, reference_id: studentId,
          result_data: { path: ['class_id'], equals: item.class_id } }, orderBy: { id: 'desc' },
      })));
      const summaries = latest.map(item => item?.result_data as typeof result | null)
        .filter((item): item is typeof result => !!item && item.hybrid?.version === HYBRID_VERSION);
      const worst = summaries.reduce<typeof result | null>((current, item) => current === null
        || (item.risk_score ?? -1) > (current.risk_score ?? -1) ? item : current, null);
      await tx.student.update({ where: { id: studentId }, data: {
        dropout_risk: worst?.risk_score ?? null, dropout_risk_level: worst?.risk_level ?? null,
        dropout_risk_reasons: json({ version: HYBRID_VERSION, reasons: worst?.top_reasons || [], details: worst }),
        dropout_risk_updated_at: now,
      } });
      const recipients = await tx.user.findMany({ where: { is_active: true,
        OR: [{ role: 'admin' }, ...(classData.teacher?.user_id ? [{ id: classData.teacher.user_id }] : [])] }, select: { id: true } });
      const warning = hybrid.level === 'high' || hybrid.level === 'medium';
      let sent = 0;
      if (warning) for (const recipient of recipients) {
        const key = `dropout:${studentId}:${classId}:hybrid:${hybrid.level}`;
        const existing = await tx.notification.findFirst({ where: {
          user_id: recipient.id, metadata: { path: ['dedup_key'], equals: key },
          createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
        } });
        if (existing) continue;
        await tx.notification.create({ data: {
          user_id: recipient.id, type: 'system_alert',
          title: `${hybrid.level === 'high' ? 'Cần liên hệ' : 'Cần theo dõi'}: ${enrollment.student.full_name} · ${hybrid.score}%`.slice(0, 255),
          message: `${classData.name}: ${reasons.join(' ')} ${action}`,
          link: `/lms/students/${studentId}?tab=classes&risk_class=${classId}`,
          metadata: json({ dedup_key: key, kind: 'hybrid_risk', student_id: studentId, class_id: classId,
            risk_score: hybrid.score, score_type: hybrid.score_type, hybrid_version: HYBRID_VERSION,
            model_version: prediction?.model_version || null, mapping_version: MAPPING_VERSION }),
        } });
        sent++;
      }
      return sent;
    });
    return { success: true, data: { student_id: studentId, ...result, notifications_created: notificationCount }, features: snapshot.features };
  }

  async scoreClass(classId: number) {
    const enrollments = await prisma.classEnrollment.findMany({ where: { class_id: classId, status: 'active' }, select: { student_id: true } });
    const results = [];
    for (const enrollment of enrollments) {
      try { results.push({ student_id: enrollment.student_id, ...await this.scoreStudent(enrollment.student_id, classId) }); }
      catch (error) { console.error('[DropoutRisk] scoring failed', classId, enrollment.student_id, error); results.push({ success: false, student_id: enrollment.student_id }); }
    }
    return results;
  }

  private async readSnapshot(studentId: number, classId: number) {
      const latest = await prisma.aIPrediction.findFirst({
        where: { prediction_type: PredictionType.dropout_risk, reference_id: studentId,
          result_data: { path: ['class_id'], equals: classId } }, orderBy: { id: 'desc' },
      });
      const data = latest?.result_data as Record<string, any> | null;
      if (!data || ![MAPPING_VERSION, 'crm_assessments_to_uci_1'].includes(data.mapping_version)) return null;
      return { student_id: studentId, class_id: classId,
        risk_score: data.hybrid?.version === HYBRID_VERSION ? data.risk_score ?? null : null,
        risk_level: data.risk_level ?? null, score_type: data.hybrid?.version === HYBRID_VERSION ? 'hybrid_risk_index' : 'academic_legacy',
        hybrid: data.hybrid?.version === HYBRID_VERSION ? data.hybrid : null, academic_score: data.academic_score ?? data.model?.risk_score ?? null,
        evidence: data.evidence || null,
        top_reasons: data.top_reasons || [], model_status: data.model_status,
        limited_data: data.snapshot?.limited_data || false, action: data.action,
        evaluated_at: latest!.createdAt.toISOString() };
  }

  async getClassSnapshots(classId: number) {
    const enrollments = await prisma.classEnrollment.findMany({ where: { class_id: classId }, select: { student_id: true } });
    const rows = await Promise.all(enrollments.map(enrollment => this.readSnapshot(enrollment.student_id, classId)));
    return rows.filter(row => row !== null);
  }

  async getStudentClassSnapshots(studentId: number, userId: number, role: string) {
    if (!['admin', 'sale', 'teacher'].includes(role)) throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
    const enrollments = await prisma.classEnrollment.findMany({
      where: { student_id: studentId, status: 'active', class: {
        status: { in: ['ongoing', 'upcoming'] }, ...(role === 'teacher' ? { teacher: { user_id: userId } } : {}),
      } },
      select: { class_id: true, class: { select: { id: true, name: true, status: true } } },
    });
    return Promise.all(enrollments.map(async enrollment => ({
      class_id: enrollment.class_id, class_name: enrollment.class.name, class_status: enrollment.class.status,
      student_id: studentId, ...(await this.readSnapshot(studentId, enrollment.class_id)),
    })));
  }

}

export const dropoutRiskService = new DropoutRiskService();
