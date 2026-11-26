// The same patterns are used in PostgreSQL to compare historical, unformatted values.
export const LEAD_PHONE_SEPARATORS = '[\\s().-]';
export const LEAD_PHONE_COUNTRY_PREFIX = '^(\\+84|0084|84)(?=[0-9]{9,10}$)';

export function normalizeLeadPhone(value?: string | null) {
    return (value || '').replace(new RegExp(LEAD_PHONE_SEPARATORS, 'g'), '')
        .replace(new RegExp(LEAD_PHONE_COUNTRY_PREFIX), '0');
}

export function normalizeLeadEmail(value?: string | null) {
    return (value || '').trim();
}
