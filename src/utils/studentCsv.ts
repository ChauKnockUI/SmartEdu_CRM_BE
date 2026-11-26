interface StudentCsvRow {
    full_name: string; phone?: string | null; email?: string | null; status: string;
    classEnrollments?: { class_id: number; status: string; class?: { name: string } }[];
    financial_summary?: { status: string; remaining_amount: number };
}
const studentLabels: Record<string, string> = { active: 'Đang học', inactive: 'Tạm ngưng', graduated: 'Đã tốt nghiệp', dropped: 'Nghỉ học' };
const debtLabels: Record<string, string> = { none: 'Chưa có khoản phải thu', pending: 'Chưa thanh toán',
    partial: 'Thanh toán một phần', paid: 'Đã thanh toán', overdue: 'Quá hạn' };
const enrollmentLabels: Record<string, string> = { dropped: 'Đã nghỉ', completed: 'Hoàn thành' };

function cell(value: unknown) {
    let text = String(value ?? '');
    // Escape spreadsheet formulas as text, as well as normal CSV quoting.
    if (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}

export function studentCsv(students: StudentCsvRow[], viewFinance: boolean) {
    const header = ['Họ tên', 'Điện thoại', 'Email', 'Trạng thái', 'Số lớp trong phạm vi', 'Lớp học trong phạm vi'];
    if (viewFinance) header.push('Trạng thái công nợ', 'Còn phải thu (VND)');
    const lines = students.map(student => {
        const enrollments = student.classEnrollments || [];
        const classes = enrollments.map(item => item.class?.name
            ? `${item.class.name}${enrollmentLabels[item.status] ? ` (${enrollmentLabels[item.status]})` : ''}` : '').filter(Boolean).join('; ');
        const row: unknown[] = [student.full_name, student.phone, student.email, studentLabels[student.status] || 'Chưa xác định', enrollments.length, classes];
        if (viewFinance) row.push(debtLabels[student.financial_summary?.status || ''] || 'Chưa xác định', student.financial_summary?.remaining_amount ?? '');
        return row.map(cell).join(',');
    });
    return '\uFEFF' + [header.map(cell).join(','), ...lines].join('\r\n') + '\r\n';
}
