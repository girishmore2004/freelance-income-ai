import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysLabel, emptyPackages, fieldErrors, formToPackages, packagesToForm } from './services.ts';

test('form packages round-trip in paise', () => {
  const form = emptyPackages();
  form.basic = { ...form.basic, price: '1,500', deliverables: '2 concepts\n\nPNG files ' };
  form.premium = { ...form.premium, on: true, price: '4999.5', deliverables: 'Everything' };
  const pk = formToPackages(form);
  assert.deepEqual(pk.map((p) => [p.key, p.price_minor, p.deliverables]), [['basic', 150000, ['2 concepts', 'PNG files']], ['premium', 499950, ['Everything']]]);
  const back = packagesToForm(pk);
  assert.equal(back.basic.price, '1500');
  assert.equal(back.standard.on, false);
  assert.equal(back.premium.deliverables, 'Everything');
});

test('labels and errors', () => {
  assert.equal(daysLabel(1), '1 day');
  assert.equal(daysLabel(5), '5 days');
  assert.equal(daysLabel(null), '');
  assert.deepEqual(fieldErrors([{ title: 'Too short', n: 1 }]), { title: 'Too short' });
  assert.deepEqual(fieldErrors(undefined), {});
});
