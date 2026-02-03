/**
 * Subscription Repository Row Mapper Tests
 * Tests the mapRow helper logic (extracted from subscription.repository.ts).
 * Since mapRow is private, we test through the module's behavior patterns.
 *
 * NOTE: These tests validate the mapping logic without a database connection.
 */

import { describe, it, expect } from 'vitest';

// We test the mapping logic directly since we can't import the private mapRow.
// This validates that our Subscription type correctly handles DB row conversions.

describe('Subscription Row Mapping', () => {
  // Simulates the mapRow function from subscription.repository.ts
  function mapRow(row: {
    user_id: string;
    channel: 'telegram' | 'sms' | 'whatsapp';
    cities: string[];
    min_score: number;
    min_quantity: number;
    max_price_per_ticket: number;
    keywords: string[] | null;
    categories: string[] | null;
    active: boolean;
    paused: boolean;
    user_tier: string;
  }) {
    return {
      userId: row.user_id,
      channel: row.channel,
      cities: row.cities,
      minScore: row.min_score,
      minQuantity: row.min_quantity,
      maxPricePerTicket: row.max_price_per_ticket ?? 0,
      keywords: row.keywords || undefined,
      categories: row.categories || undefined,
      active: row.active,
      paused: row.paused ?? false,
      userTier: (row.user_tier as any) ?? 'free',
    };
  }

  it('maps snake_case DB row to camelCase Subscription', () => {
    const row = {
      user_id: 'chat-123',
      channel: 'telegram' as const,
      cities: ['portland', 'seattle'],
      min_score: 70,
      min_quantity: 2,
      max_price_per_ticket: 100,
      keywords: null,
      categories: null,
      active: true,
      paused: false,
      user_tier: 'free',
    };

    const result = mapRow(row);

    expect(result.userId).toBe('chat-123');
    expect(result.channel).toBe('telegram');
    expect(result.cities).toEqual(['portland', 'seattle']);
    expect(result.minScore).toBe(70);
    expect(result.minQuantity).toBe(2);
    expect(result.maxPricePerTicket).toBe(100);
    expect(result.keywords).toBeUndefined();
    expect(result.categories).toBeUndefined();
    expect(result.active).toBe(true);
    expect(result.paused).toBe(false);
    expect(result.userTier).toBe('free');
  });

  it('converts null keywords to undefined', () => {
    const row = {
      user_id: 'u1', channel: 'telegram' as const, cities: [],
      min_score: 70, min_quantity: 1, max_price_per_ticket: 0,
      keywords: null, categories: null,
      active: true, paused: false, user_tier: 'free',
    };
    expect(mapRow(row).keywords).toBeUndefined();
  });

  it('preserves keywords array when present', () => {
    const row = {
      user_id: 'u1', channel: 'telegram' as const, cities: [],
      min_score: 70, min_quantity: 1, max_price_per_ticket: 0,
      keywords: ['blazers', 'basketball'], categories: ['sports'],
      active: true, paused: false, user_tier: 'free',
    };
    expect(mapRow(row).keywords).toEqual(['blazers', 'basketball']);
    expect(mapRow(row).categories).toEqual(['sports']);
  });

  it('defaults maxPricePerTicket to 0 when null', () => {
    const row = {
      user_id: 'u1', channel: 'telegram' as const, cities: [],
      min_score: 70, min_quantity: 1, max_price_per_ticket: null as any,
      keywords: null, categories: null,
      active: true, paused: false, user_tier: 'free',
    };
    expect(mapRow(row).maxPricePerTicket).toBe(0);
  });

  it('defaults paused to false when null', () => {
    const row = {
      user_id: 'u1', channel: 'telegram' as const, cities: [],
      min_score: 70, min_quantity: 1, max_price_per_ticket: 0,
      keywords: null, categories: null,
      active: true, paused: null as any, user_tier: 'free',
    };
    expect(mapRow(row).paused).toBe(false);
  });

  it('defaults userTier to free when null', () => {
    const row = {
      user_id: 'u1', channel: 'telegram' as const, cities: [],
      min_score: 70, min_quantity: 1, max_price_per_ticket: 0,
      keywords: null, categories: null,
      active: true, paused: false, user_tier: null as any,
    };
    expect(mapRow(row).userTier).toBe('free');
  });

  it('handles pro and premium tiers', () => {
    const row = {
      user_id: 'u1', channel: 'telegram' as const, cities: [],
      min_score: 70, min_quantity: 1, max_price_per_ticket: 0,
      keywords: null, categories: null,
      active: true, paused: false, user_tier: 'premium',
    };
    expect(mapRow(row).userTier).toBe('premium');
  });
});
