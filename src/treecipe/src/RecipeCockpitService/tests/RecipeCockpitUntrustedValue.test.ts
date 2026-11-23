import * as fs from 'fs';
import * as path from 'path';
import { RecipeCockpitUntrustedValue } from '../RecipeCockpitUntrustedValue';

describe('RecipeCockpitUntrustedValue', () => {

    describe('isPlainRecord', () => {

        test.each([
            ['an object', { kind: 'tree' }, true],
            ['an object with no prototype', Object.create(null), true],
            ['null', null, false],
            ['an array', ['kind'], false],
            ['a string', 'kind', false],
            ['undefined', undefined, false]
        ])('%s answers %s', (_label, candidate, expected) => {
            expect(RecipeCockpitUntrustedValue.isPlainRecord(candidate)).toBe(expected);
        });

    });

    describe('describeThrown', () => {

        test('an Error reads as its message', () => {
            expect(RecipeCockpitUntrustedValue.describeThrown(new Error('sfdx-project.json is missing'))).toBe('sfdx-project.json is missing');
        });

        test('a thrown string reads as itself', () => {
            expect(RecipeCockpitUntrustedValue.describeThrown('timed out')).toBe('timed out');
        });

        test('a thrown undefined reads as "undefined"', () => {
            expect(RecipeCockpitUntrustedValue.describeThrown(undefined)).toBe('undefined');
        });

    });

    test('imports nothing, so a host-free file can load it', () => {
        const source = fs.readFileSync(path.join(__dirname, '..', 'RecipeCockpitUntrustedValue.ts'), 'utf8');
        expect(source).not.toMatch(/^\s*import\b/m);
    });

});
