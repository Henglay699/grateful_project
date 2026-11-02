import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useOverviewWidgets } from './widgets';

beforeEach(() => localStorage.clear());

describe('Overview widgets', () => {
  it('shows the Overview as it comes: profit for accounting, client share for the rest', () => {
    const acc = renderHook(() => useOverviewWidgets('u1', true)).result.current;
    expect([acc.shown('profit'), acc.shown('clients'), acc.shown('map')]).toEqual([
      true,
      false,
      true,
    ]);
    const ops = renderHook(() => useOverviewWidgets('u2', false)).result.current;
    expect([ops.shown('profit'), ops.shown('clients')]).toEqual([false, true]);
  });

  it('remembers a removed or added widget per user, and resets', () => {
    const { result } = renderHook(() => useOverviewWidgets('u1', true));
    act(() => result.current.toggle('map'));
    act(() => result.current.toggle('clients'));
    expect([result.current.shown('map'), result.current.shown('clients')]).toEqual([false, true]);
    expect(result.current.customized).toBe(true);

    const again = renderHook(() => useOverviewWidgets('u1', true)).result.current;
    expect([again.shown('map'), again.shown('clients')]).toEqual([false, true]);
    expect(renderHook(() => useOverviewWidgets('u3', true)).result.current.shown('map')).toBe(true);

    act(() => result.current.reset());
    expect(result.current.shown('map')).toBe(true);
    expect(result.current.customized).toBe(false);
  });

  it('never shows profit without accounting access, even if stored', () => {
    localStorage.setItem('gs:overview-widgets:u1', JSON.stringify({ profit: true }));
    expect(renderHook(() => useOverviewWidgets('u1', false)).result.current.shown('profit')).toBe(
      false,
    );
  });
});
