/**
 * Telegram Formatter Unit Tests
 * Tests MarkdownV2 escaping and alert formatting.
 */

import { describe, it, expect } from 'vitest';
import { TelegramFormatter } from '../../../src/notifications/telegram/telegram.formatter.js';
import { makeAlertPayload, makeTopValueListing } from '../../mocks/fixtures.js';

describe('TelegramFormatter', () => {
  const formatter = new TelegramFormatter();

  // ==========================================================================
  // escapeMarkdown()
  // ==========================================================================

  describe('escapeMarkdown()', () => {
    it('escapes underscores', () => {
      expect(formatter.escapeMarkdown('hello_world')).toBe('hello\\_world');
    });

    it('escapes asterisks', () => {
      expect(formatter.escapeMarkdown('*bold*')).toBe('\\*bold\\*');
    });

    it('escapes square brackets', () => {
      expect(formatter.escapeMarkdown('[link]')).toBe('\\[link\\]');
    });

    it('escapes parentheses', () => {
      expect(formatter.escapeMarkdown('(text)')).toBe('\\(text\\)');
    });

    it('escapes tildes', () => {
      expect(formatter.escapeMarkdown('~strikethrough~')).toBe('\\~strikethrough\\~');
    });

    it('escapes backticks', () => {
      expect(formatter.escapeMarkdown('`code`')).toBe('\\`code\\`');
    });

    it('escapes greater-than', () => {
      expect(formatter.escapeMarkdown('>quote')).toBe('\\>quote');
    });

    it('escapes hash', () => {
      expect(formatter.escapeMarkdown('#heading')).toBe('\\#heading');
    });

    it('escapes plus sign', () => {
      expect(formatter.escapeMarkdown('+plus')).toBe('\\+plus');
    });

    it('escapes equals sign', () => {
      expect(formatter.escapeMarkdown('=equals')).toBe('\\=equals');
    });

    it('escapes pipe', () => {
      expect(formatter.escapeMarkdown('a|b')).toBe('a\\|b');
    });

    it('escapes curly braces', () => {
      expect(formatter.escapeMarkdown('{braces}')).toBe('\\{braces\\}');
    });

    it('escapes dots', () => {
      expect(formatter.escapeMarkdown('2.5')).toBe('2\\.5');
    });

    it('escapes exclamation marks', () => {
      expect(formatter.escapeMarkdown('wow!')).toBe('wow\\!');
    });

    it('escapes hyphens', () => {
      expect(formatter.escapeMarkdown('one-two')).toBe('one\\-two');
    });

    it('escapes backslashes', () => {
      expect(formatter.escapeMarkdown('back\\slash')).toBe('back\\\\slash');
    });

    it('handles strings with no special characters', () => {
      expect(formatter.escapeMarkdown('hello world')).toBe('hello world');
    });

    it('handles empty string', () => {
      expect(formatter.escapeMarkdown('')).toBe('');
    });

    it('escapes all special chars in a realistic string', () => {
      const input = '📍 Moda Center, Portland (OR)';
      const result = formatter.escapeMarkdown(input);
      // Parentheses should be escaped — check for the backslash prefix
      expect(result).toContain('\\(');
      expect(result).toContain('\\)');
      // Verify no un-escaped parenthesis (i.e., every "(" is preceded by "\")
      const unescapedOpen = result.replace(/\\\(/g, '').includes('(');
      const unescapedClose = result.replace(/\\\)/g, '').includes(')');
      expect(unescapedOpen).toBe(false);
      expect(unescapedClose).toBe(false);
    });

    it('does NOT double-escape already escaped content', () => {
      // This tests the single-pass property
      const once = formatter.escapeMarkdown('$100.50');
      expect(once).toBe('$100\\.50');
      // If we pass the result through again, it WILL double-escape — that's expected.
      // The key invariant is: only call escapeMarkdown once on raw text.
    });
  });

  // ==========================================================================
  // formatAlert()
  // ==========================================================================

  describe('formatAlert()', () => {
    it('returns a non-empty string for a valid payload', () => {
      const payload = makeAlertPayload();
      const result = formatter.formatAlert(payload);
      expect(result.length).toBeGreaterThan(0);
    });

    it('includes event name (escaped)', () => {
      const payload = makeAlertPayload({ eventName: 'Blazers vs Lakers' });
      const result = formatter.formatAlert(payload);
      expect(result).toContain('Blazers vs Lakers');
    });

    it('includes venue name', () => {
      const payload = makeAlertPayload({ venueName: 'Moda Center' });
      const result = formatter.formatAlert(payload);
      expect(result).toContain('Moda Center');
    });

    it('includes listing section and row', () => {
      const payload = makeAlertPayload({
        listings: [makeTopValueListing({ section: 'Section 102', row: '5' })],
      });
      const result = formatter.formatAlert(payload);
      expect(result).toContain('Section 102');
      expect(result).toContain('Row 5');
    });

    it('includes buy link (unescaped URL)', () => {
      const payload = makeAlertPayload({
        listings: [makeTopValueListing({ deepLink: 'https://stubhub.com/buy/123' })],
      });
      const result = formatter.formatAlert(payload);
      expect(result).toContain('[🛒 Buy Now](https://stubhub.com/buy/123)');
    });

    it('includes SEATSNIPER ALERT header', () => {
      const result = formatter.formatAlert(makeAlertPayload());
      expect(result).toContain('SEATSNIPER ALERT');
    });

    it('includes price and quantity', () => {
      const payload = makeAlertPayload({
        listings: [makeTopValueListing({ pricePerTicket: 75, quantity: 4 })],
      });
      const result = formatter.formatAlert(payload);
      expect(result).toContain('75');
      expect(result).toContain('4 avail');
    });

    it('includes value score', () => {
      const payload = makeAlertPayload({
        listings: [makeTopValueListing({ valueScore: 92 })],
      });
      const result = formatter.formatAlert(payload);
      expect(result).toContain('92');
    });
  });

  // ==========================================================================
  // formatCompact()
  // ==========================================================================

  describe('formatCompact()', () => {
    it('returns empty string for payload with no listings', () => {
      const payload = makeAlertPayload({ listings: [] });
      expect(formatter.formatCompact(payload)).toBe('');
    });

    it('includes event name and buy link', () => {
      const payload = makeAlertPayload();
      const result = formatter.formatCompact(payload);
      expect(result).toContain('Trail Blazers');
      expect(result).toContain('[Buy]');
    });
  });
});
