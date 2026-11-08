import * as fs from 'fs';
import * as path from 'path';

// ObjectInfoWrapper, SOQLTemplateService and MermaidService hold names to this rule without vscode or RecipeService (#572)
describe('SalesforceApiName', () => {

    test('imports nothing', () => {

        const source = fs.readFileSync(path.join(__dirname, '..', 'SalesforceApiName.ts'), 'utf8');

        expect(source).not.toMatch(/^\s*import\s/m);
        expect(source).not.toMatch(/require\(/);

    });

});
