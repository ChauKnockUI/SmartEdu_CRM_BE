// Values are persisted verbatim in leads.lead_source; labels are presentation only.
export const LEAD_SOURCES = [
    { value: 'facebook', label: 'Facebook Ads' },
    { value: 'google_ads', label: 'Google Ads' },
    { value: 'website_organic', label: 'Website Organic' },
    { value: 'website', label: 'Website' },
    { value: 'zalo', label: 'Zalo' },
    { value: 'tiktok', label: 'TikTok' },
    { value: 'referral', label: 'Giới thiệu' },
    { value: 'other', label: 'Khác' },
] as const;

export const isLeadSource = (value: unknown): value is string =>
    typeof value === 'string' && LEAD_SOURCES.some(source => source.value === value);

export function validateLeadSource(value: unknown, existingValue?: string | null) {
    // Old sources may remain unchanged, but cannot be assigned to other leads.
    if (isLeadSource(value) || (typeof value === 'string' && value === existingValue)) return;
    throw Object.assign(new Error(`Nguồn lead phải thuộc [${LEAD_SOURCES.map(source => source.value).join(', ')}].`), { statusCode: 400 });
}
