import { FieldInfo } from "../FieldInfo";

describe('FieldInfo.applyFieldSize', () => {

  const buildFieldInfo = () => FieldInfo.create('Account', 'Amount__c', 'Amount', 'Currency', null, null, null, null);

  test('records each size the XML had', () => {

    const fieldInfo = FieldInfo.applyFieldSize(buildFieldInfo(), { length: 50, precision: 18, scale: 2 });

    expect([fieldInfo.length, fieldInfo.precision, fieldInfo.scale]).toEqual([50, 18, 2]);

  });

  test('records a scale of 0, which is a size rather than an absence', () => {

    expect(FieldInfo.applyFieldSize(buildFieldInfo(), { precision: 18, scale: 0 }).scale).toBe(0);

  });

  test('records nothing for a size that is absent or not an integer, so the field serializes as before', () => {

    const fieldInfo = FieldInfo.applyFieldSize(buildFieldInfo(), { length: undefined, precision: NaN, scale: 2.5 });
    const serializedKeys = Object.keys(JSON.parse(JSON.stringify(fieldInfo)));

    expect(serializedKeys).not.toContain('length');
    expect(serializedKeys).not.toContain('precision');
    expect(serializedKeys).not.toContain('scale');

  });

});
