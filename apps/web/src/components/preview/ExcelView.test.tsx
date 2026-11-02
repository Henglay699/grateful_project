import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ExcelJS from 'exceljs';
import { ExcelView } from './ExcelView';

async function workbook(): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Ledger');
  ws.getCell('A1').value = 'Invoice summary';
  ws.getCell('A1').font = { bold: true };
  ws.mergeCells('A1:C1');
  ws.getCell('A2').value = 'Amount';
  ws.getCell('B2').value = 1234.5;
  ws.getCell('B2').numFmt = '#,##0.00';
  ws.getCell('C2').value = 0.1;
  ws.getCell('C2').numFmt = '0%';
  ws.getCell('A3').value = { formula: 'B2*2', result: 2469 };
  wb.addWorksheet('Notes').getCell('A1').value = 'Second sheet';
  const buf = await wb.xlsx.writeBuffer();
  // jsdom's Blob has no arrayBuffer() (real browsers do), so supply it.
  return Object.assign(new Blob([buf]), { arrayBuffer: async () => buf });
}

describe('ExcelView', () => {
  it('renders formatted cells, merges and sheet tabs', async () => {
    render(<ExcelView blob={await workbook()} zoom={1} onError={() => {}} />);

    const title = await screen.findByText('Invoice summary');
    expect(title).toHaveAttribute('colspan', '3');
    expect(title).toHaveStyle({ fontWeight: '700' });
    expect(screen.getByText('1,234.50')).toBeInTheDocument();
    expect(screen.getByText('10%')).toBeInTheDocument();
    expect(screen.getByText('2469')).toBeInTheDocument(); // formula shows its result

    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }));
    expect(await screen.findByText('Second sheet')).toBeInTheDocument();
  });
});
