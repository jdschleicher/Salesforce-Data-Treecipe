import * as fs from 'fs';
import * as path from 'path';
import { PersonNameObjects } from '../PersonNameObjects';

describe('PersonNameObjects (#114)', () => {

    test('the person-style objects are Contact, Lead and Individual, and no other', () => {

        expect(PersonNameObjects.objectApiNames).toEqual(['Contact', 'Lead', 'Individual']);

    });

    test.each(['Contact', 'Lead', 'Individual'])('%s is a person-style object', (objectApiName) => {

        expect(PersonNameObjects.includes(objectApiName)).toBe(true);

    });

    test.each(['Account', 'User', 'contact', '', undefined])('%s is not', (objectApiName) => {

        expect(PersonNameObjects.includes(objectApiName as string)).toBe(false);

    });

    test('imports nothing, so generation and the SOQL templates can both read it', () => {

        const sourceText = fs.readFileSync(path.join(__dirname, '..', 'PersonNameObjects.ts'), 'utf8');

        expect(sourceText).not.toMatch(/^\s*import\s/m);

    });

});
