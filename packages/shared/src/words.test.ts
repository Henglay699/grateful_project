import { describe, expect, it } from 'vitest';
import { amountInWords, integerInWords } from './words';

describe('amountInWords (official receipts)', () => {
  it('matches the wording of the Excel receipts', () => {
    expect(amountInWords(12790.89)).toBe(
      'TWELVE THOUSAND SEVEN HUNDRED NINETY DOLLARS AND EIGHTY NINE CENTS.',
    );
    expect(amountInWords('6540.25')).toBe(
      'SIX THOUSAND FIVE HUNDRED FORTY DOLLARS AND TWENTY FIVE CENTS.',
    );
  });

  it('writes the September JR statement totals', () => {
    expect(amountInWords(8978.51)).toBe(
      'EIGHT THOUSAND NINE HUNDRED SEVENTY EIGHT DOLLARS AND FIFTY ONE CENTS.',
    );
    expect(amountInWords('7837.75')).toBe(
      'SEVEN THOUSAND EIGHT HUNDRED THIRTY SEVEN DOLLARS AND SEVENTY FIVE CENTS.',
    );
  });

  it('handles whole amounts, singulars, teens and zero', () => {
    expect(amountInWords(80)).toBe('EIGHTY DOLLARS ONLY.');
    expect(amountInWords(1.01)).toBe('ONE DOLLAR AND ONE CENT.');
    expect(amountInWords('0.15')).toBe('ZERO DOLLARS AND FIFTEEN CENTS.');
    expect(amountInWords(0)).toBe('ZERO DOLLARS ONLY.');
    expect(amountInWords(113)).toBe('ONE HUNDRED THIRTEEN DOLLARS ONLY.');
  });

  it('handles large amounts and rounds to the cent', () => {
    expect(integerInWords(1_000_000)).toBe('ONE MILLION');
    expect(integerInWords(2_005_040)).toBe('TWO MILLION FIVE THOUSAND FORTY');
    expect(amountInWords(1_234_567_890.12)).toBe(
      'ONE BILLION TWO HUNDRED THIRTY FOUR MILLION FIVE HUNDRED SIXTY SEVEN THOUSAND EIGHT HUNDRED NINETY DOLLARS AND TWELVE CENTS.',
    );
    expect(amountInWords(10.005)).toBe('TEN DOLLARS AND ONE CENT.');
  });
});
