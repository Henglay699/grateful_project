import { describe, expect, it } from 'vitest';
import { khmerLunarText, khmerSolarText } from './khmerDate';

describe('Khmer dates', () => {
  it('matches the dates on JR’s own import letters', () => {
    expect(khmerLunarText('2026-09-15')).toBe(
      'ថ្ងៃអង្គារ ៤កើត ខែភទ្របទ ឆ្នាំមមី អដ្ឋស័ក ពុទ្ធសករាជ ២៥៧០',
    );
    expect(khmerSolarText('2026-09-15')).toBe('រាជធានីភ្នំពេញ ថ្ងៃទី១៥ ខែកញ្ញា ឆ្នាំ២០២៦');
    // Before Khmer New Year and Visak Bochea: the old animal year, era and Buddhist year.
    expect(khmerLunarText('2026-03-27')).toBe(
      'ថ្ងៃសុក្រ ៩កើត ខែចេត្រ ឆ្នាំម្សាញ់ សប្តស័ក ពុទ្ធសករាជ ២៥៦៩',
    );
  });

  it('lands public holidays on their lunar days', () => {
    // Visak Bochea (15 kert Pisakh), Pchum Ben (15 roach Photrobot), Water Festival (15 kert Kadeuk).
    expect(khmerLunarText('2025-05-11')).toContain('១៥កើត ខែពិសាខ');
    expect(khmerLunarText('2024-05-22')).toContain('១៥កើត ខែពិសាខ');
    expect(khmerLunarText('2025-09-22')).toContain('១៥រោច ខែភទ្របទ');
    expect(khmerLunarText('2022-09-25')).toContain('១៥រោច ខែភទ្របទ');
    expect(khmerLunarText('2025-11-05')).toContain('១៥កើត ខែកត្តិក');
  });
});
