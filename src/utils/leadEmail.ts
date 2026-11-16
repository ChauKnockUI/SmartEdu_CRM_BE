import { createHash } from 'crypto';

// Keep the retry identifier in the existing activity content; strip it from API views.
export const leadEmailRequestPrefix = (requestId: string) => `[crm-email:${requestId}:`;
export const leadEmailContentPrefix = (requestId: string, to: string, subject: string, text: string) =>
    `${leadEmailRequestPrefix(requestId)}${createHash('sha256').update(JSON.stringify([to, subject, text])).digest('hex')}]\n`;

export function presentLeadActivity<T extends { type: string; content?: string | null }>(activity: T): T & { email_delivery?: 'accepted' } {
    if (activity.type !== 'email' || !activity.content) return activity;
    const marker = /^\[crm-email:[0-9a-f-]{36}:[0-9a-f]{64}\]\n/i;
    return marker.test(activity.content)
        ? { ...activity, content: activity.content.replace(marker, ''), email_delivery: 'accepted' }
        : activity;
}
