/** Money conversion for listing forms (rupees in the UI, paise in the API). Run: npm run test:unit */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBudget, linesToList, minorToRupees, rupeesToMinor } from './listing-format.ts';

test('rupees convert to integer paise without floating-point drift', () => {
  assert.equal(rupeesToMinor('25000'), 2_500_000);
  assert.equal(rupeesToMinor('1,00,000'), 10_000_000);
  assert.equal(rupeesToMinor('0.29'), 29);
  assert.equal(rupeesToMinor('19.99'), 1999);
  assert.equal(rupeesToMinor(''), null);
  assert.ok(Number.isNaN(rupeesToMinor('12.345') as number));
  assert.ok(Number.isNaN(rupeesToMinor('-5') as number));
  assert.ok(Number.isNaN(rupeesToMinor('abc') as number));
});

test('paise convert back for editing', () => {
  assert.equal(minorToRupees(2_500_000), '25000');
  assert.equal(minorToRupees(1999), '19.99');
  assert.equal(minorToRupees(null), '');
});

test('budget ranges render in INR', () => {
  assert.match(formatBudget(2_500_000, 5_000_000, 'INR', 'fixed'), /25,000.*50,000/);
  assert.match(formatBudget(null, 80_000, 'INR', 'hourly'), /^Up to .*800 per hour$/);
  assert.equal(formatBudget(null, null, 'INR', 'fixed'), 'Budget not set');
});

test('multi-line fields become clean lists', () => {
  assert.deepEqual(linesToList(' Home page \n\n About page\n'), ['Home page', 'About page']);
});
