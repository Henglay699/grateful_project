import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { cleanNumber, groupNumber, NumberInput } from './NumberInput';

describe('cleanNumber / groupNumber', () => {
  it('keeps only a number and groups thousands', () => {
    expect(cleanNumber('1,2a34.5x6')).toBe('1234.56');
    expect(cleanNumber('12.3.4')).toBe('12.34');
    expect(cleanNumber('9.8765', 2)).toBe('9.87');
    expect(cleanNumber('4,026.5', 0)).toBe('40265');
    expect(cleanNumber('-50')).toBe('50');
    expect(cleanNumber('-50', 2, true)).toBe('-50');
    expect(groupNumber('1234567.50')).toBe('1,234,567.50');
    expect(groupNumber('999')).toBe('999');
    expect(groupNumber('-1234.')).toBe('-1,234.');
    expect(groupNumber('')).toBe('');
  });
});

describe('NumberInput', () => {
  it('with react-hook-form: shows commas, the form gets the plain number', async () => {
    let submitted: Record<string, string> = {};
    function Form() {
      const { register, handleSubmit, watch } = useForm({
        defaultValues: { amount: '15208.84', qty: '' },
      });
      return (
        <form onSubmit={handleSubmit((v) => (submitted = v))}>
          <NumberInput aria-label="Amount" decimals={2} {...register('amount')} />
          <NumberInput aria-label="Qty" decimals={0} {...register('qty')} />
          <output>{Number(watch('amount')) * 2}</output>
          <button type="submit">Save</button>
        </form>
      );
    }
    render(<Form />);
    const amount = screen.getByLabelText<HTMLInputElement>('Amount');
    expect(amount.value).toBe('15,208.84');

    await userEvent.clear(amount);
    await userEvent.type(amount, '1234567.891abc');
    expect(amount.value).toBe('1,234,567.89');
    expect(screen.getByRole('status').textContent).toBe('2469135.78');

    const qty = screen.getByLabelText<HTMLInputElement>('Qty');
    await userEvent.type(qty, '12.5-0');
    expect(qty.value).toBe('1,250');

    await userEvent.click(screen.getByText('Save'));
    expect(submitted).toEqual({ amount: '1234567.89', qty: '1250' });
  });

  it('controlled: the state holds the plain number', async () => {
    let state = '';
    function Box() {
      const [v, setV] = useState('4026');
      state = v;
      return <NumberInput aria-label="Rate" value={v} onChange={(e) => setV(e.target.value)} />;
    }
    render(<Box />);
    const box = screen.getByLabelText<HTMLInputElement>('Rate');
    expect(box.value).toBe('4,026');
    await userEvent.type(box, '00');
    expect(box.value).toBe('402,600');
    expect(state).toBe('402600');
  });
});
