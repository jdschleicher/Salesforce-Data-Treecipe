import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';

// RecipeService REACHES vscode THROUGH ErrorHandlingService; THE MODULE UNDER TEST DOES NOT
jest.mock('vscode', () => ({ workspace: { getConfiguration: jest.fn().mockReturnValue({ get: jest.fn() }) }, window: {} }), { virtual: true });

import {
    IObjectRefreshComparisonRequest,
    IObjectRefreshPlannedItem,
    IObjectRefreshRecipeContext,
    OBJECT_REFRESH_KINDS,
    OBJECT_REFRESH_RECIPE_NOTES,
    ObjectRefreshKind,
    RecipeCockpitObjectRefresh
} from '../RecipeCockpitObjectRefresh';
import { RecipeService } from '../../RecipeService/RecipeService';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { INJECTED_FIELD_API_NAME, QUOTE_PAYLOADS } from '../../RecipeYamlScalar/tests/mocks/HostilePicklistValues';

// THE PROJECT'S Account AND THE SAME OBJECT AS THE ORG ANSWERED IT; SEE mocks/objectRefresh
const OBJECT_REFRESH_MOCKS = path.join(__dirname, 'mocks', 'objectRefresh');

const RECIPE_BY_BACKEND = {
    'snowfakery': [
        '- object: Account',
        '  nickname: Account_NickName',
        '  count: 1',
        '  fields:',
        '    Name: ${{fake.Company}}',
        '    Legacy_Code__c: ${{fake.Word}}',
        '    Annual_Budget__c: ${{ random_number(min=0, max=9999999999999999) }}',
        "    Rating__c: ${{ random_choice('Hot','Warm','Cold') }}",
        '    Regions__c: ### TODO -- NO PICKLIST VALUES',
        '',
        '- object: Contact',
        '  count: 1',
        '  fields:',
        '    LastName: ${{fake.LastName}}',
        ''
    ].join('\n'),
    'faker-js': [
        '- object: Account',
        '  nickname: Account_NickName',
        '  count: 1',
        '  fields:',
        '    Name: ${{ faker.company.name() }}',
        '    Legacy_Code__c: ${{ faker.lorem.word() }}',
        '    Annual_Budget__c: |',
        '            ${{ faker.finance.amount({min: 0, max: 9999999999999999, dec: 2}) }}',
        '    Rating__c: ${{ faker.helpers.arrayElement([`Hot`,`Warm`,`Cold`]) }}',
        '    Regions__c: ### TODO -- NO PICKLIST VALUES',
        '',
        '- object: Contact',
        '  count: 1',
        '  fields:',
        '    LastName: ${{ faker.person.lastName() }}',
        ''
    ].join('\n')
} as const;

type Backend = keyof typeof RECIPE_BY_BACKEND;
const BACKENDS: Backend[] = ['snowfakery', 'faker-js'];

const buildExpressionSource = (backend: Backend) => new RecipeService(backend === 'faker-js' ? new FakerJSRecipeFakerService() : new SnowfakeryRecipeFakerService());

describe('RecipeCockpitObjectRefresh (#612)', () => {

    let temporaryRoot: string;
    let workspaceRoot: string;
    let stagingFolderPath: string;

    const buildRequest = (overrides: Partial<IObjectRefreshComparisonRequest> = {}, recipeOverrides: Partial<IObjectRefreshRecipeContext> = {}, backend: Backend = 'snowfakery'): IObjectRefreshComparisonRequest => ({
        workspaceRoot: workspaceRoot,
        packageDirectoryPaths: ['force-app'],
        defaultPackageDirectoryPath: 'force-app',
        stagingFolderPath: stagingFolderPath,
        objectApiName: 'Account',
        kinds: OBJECT_REFRESH_KINDS,
        valueSetNames: ['Regions'],
        recipeContext: {
            recipeText: RECIPE_BY_BACKEND[backend],
            expressionSource: buildExpressionSource(backend),
            pinnedFieldApiNames: new Set(),
            validationRulesOffFieldApiNames: new Set(),
            ...recipeOverrides
        },
        ...overrides
    });

    const compare = async (overrides: Partial<IObjectRefreshComparisonRequest> = {}, recipeOverrides: Partial<IObjectRefreshRecipeContext> = {}, backend: Backend = 'snowfakery') =>
        RecipeCockpitObjectRefresh.compareStagedObject(buildRequest(overrides, recipeOverrides, backend));

    const itemNamed = (items: IObjectRefreshPlannedItem[], kind: ObjectRefreshKind, name: string) => items.find(item => item.kind === kind && item.name === name);
    const projectPath = (...segments: string[]) => path.join(workspaceRoot, 'force-app', 'main', 'default', ...segments);
    const stagedPath = (...segments: string[]) => path.join(stagingFolderPath, 'main', 'default', ...segments);

    beforeEach(() => {
        temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-object-refresh-'));
        workspaceRoot = path.join(temporaryRoot, 'workspace');
        fs.cpSync(path.join(OBJECT_REFRESH_MOCKS, 'project'), path.join(workspaceRoot, 'force-app'), { recursive: true });
        stagingFolderPath = path.join(workspaceRoot, 'treecipe', 'staging');
        fs.cpSync(path.join(OBJECT_REFRESH_MOCKS, 'staged'), stagingFolderPath, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    });

    describe('buildRetrieveComponents and buildPackageXml', () => {

        it('names the object, and the global value sets only when that kind is ticked', () => {
            expect(RecipeCockpitObjectRefresh.buildRetrieveComponents('Account', ['fields'], ['Regions'])).toEqual([{ type: 'CustomObject', member: 'Account' }]);
            expect(RecipeCockpitObjectRefresh.buildRetrieveComponents('Account', ['globalValueSets'], ['Zones', 'Regions', 'Regions', 'not a name'])).toEqual([
                { type: 'CustomObject', member: 'Account' },
                { type: 'GlobalValueSet', member: 'Regions' },
                { type: 'GlobalValueSet', member: 'Zones' }
            ]);
        });

        it('refuses an object name that is not an api name', () => {
            expect(() => RecipeCockpitObjectRefresh.buildRetrieveComponents('Account</members>', ['fields'], [])).toThrow('is not an object api name, so nothing was retrieved.');
        });

        it('writes one types block per type, members sorted with "<"', () => {
            const packageXml = RecipeCockpitObjectRefresh.buildPackageXml([{ type: 'GlobalValueSet', member: 'Regions' }, { type: 'CustomObject', member: 'Account' }], '62.0');
            expect(packageXml).toBe([
                '<?xml version="1.0" encoding="UTF-8"?>',
                '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
                '    <types>',
                '        <members>Account</members>',
                '        <name>CustomObject</name>',
                '    </types>',
                '    <types>',
                '        <members>Regions</members>',
                '        <name>GlobalValueSet</name>',
                '    </types>',
                '    <version>62.0</version>',
                '</Package>',
                ''
            ].join('\n'));
            expect(() => RecipeCockpitObjectRefresh.buildPackageXml([])).toThrow('No component was named');
        });

        it('lists the global value sets the object\'s project fields use', async () => {
            expect(await RecipeCockpitObjectRefresh.listObjectValueSetNames(workspaceRoot, ['force-app'], 'Account')).toEqual(['Regions']);
            expect(await RecipeCockpitObjectRefresh.listObjectValueSetNames(workspaceRoot, ['force-app'], 'Contact')).toEqual([]);
        });

    });

    describe('compareStagedObject, fields', () => {

        it('lists new and changed fields only, each with the file it copies, and counts unchanged and unreadable ones', async () => {

            const comparison = await compare({ kinds: ['fields'] });

            expect(comparison.isRetrieved).toBe(true);
            expect(comparison.items.map(item => `${item.status} ${item.name}`)).toEqual(['new Is_Priority__c', 'new Region_Owner__c', 'new Score__c', 'new Total__c', 'changed Legacy_Code__c']);
            expect(comparison.unchangedCountByKind.fields).toBe(3);
            expect(comparison.unreadableCountByKind.fields).toBe(1);

            const legacyCode = itemNamed(comparison.items, 'fields', 'Legacy_Code__c')!;
            expect(legacyCode.differences).toEqual(['length: 50 → 255']);
            expect(legacyCode.fileCopy).toEqual({ componentLabel: 'Account.Legacy_Code__c', stagedFilePath: stagedPath('objects', 'Account', 'fields', 'Legacy_Code__c.field-meta.xml'), targetFilePath: projectPath('objects', 'Account', 'fields', 'Legacy_Code__c.field-meta.xml') });
            expect(itemNamed(comparison.items, 'fields', 'Is_Priority__c')!.fileCopy.targetFilePath).toBe(projectPath('objects', 'Account', 'fields', 'Is_Priority__c.field-meta.xml'));

        });

        it.each(BACKENDS)('writes the %s backend\'s expression: a new field is inserted, a changed one replaced', async (backend) => {

            const comparison = await compare({ kinds: ['fields'] }, {}, backend);
            const isFakerJs = backend === 'faker-js';

            expect(itemNamed(comparison.items, 'fields', 'Is_Priority__c')).toMatchObject({
                recipeNote: OBJECT_REFRESH_RECIPE_NOTES.addsLine,
                recipeChanges: [{ operation: 'insert', fieldApiName: 'Is_Priority__c', valueText: isFakerJs ? '${{ faker.datatype.boolean() }}' : '${{ (random_choice("true", "false")).lower() }}' }]
            });
            expect(itemNamed(comparison.items, 'fields', 'Legacy_Code__c')).toMatchObject({
                recipeNote: OBJECT_REFRESH_RECIPE_NOTES.rewritesLine,
                recipeChanges: [{ operation: 'replace', fieldApiName: 'Legacy_Code__c', valueText: isFakerJs ? '${{ faker.lorem.text(255).substring(0, 255) }}' : '${{fake.text(max_nb_chars=255)}}' }]
            });

        });

        it('changes only the project file for a formula, a lookup, a dependent picklist, and a type with no generated value', async () => {

            fs.writeFileSync(stagedPath('objects', 'Account', 'fields', 'Sub_Rating__c.field-meta.xml'), [
                '<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">',
                '    <fullName>Sub_Rating__c</fullName><label>Sub Rating</label><type>Picklist</type>',
                '    <valueSet><controllingField>Rating__c</controllingField><valueSetDefinition><value><fullName>Very Hot</fullName></value></valueSetDefinition></valueSet>',
                '</CustomField>'
            ].join('\n'));
            fs.writeFileSync(stagedPath('objects', 'Account', 'fields', 'Mystery__c.field-meta.xml'), '<CustomField><fullName>Mystery__c</fullName><label>Mystery</label><type>NotAType</type></CustomField>');

            const { items } = await compare({ kinds: ['fields'] });

            expect(itemNamed(items, 'fields', 'Total__c')).toMatchObject({ recipeNote: OBJECT_REFRESH_RECIPE_NOTES.formula, recipeChanges: [] });
            expect(itemNamed(items, 'fields', 'Region_Owner__c')).toMatchObject({ recipeNote: OBJECT_REFRESH_RECIPE_NOTES.lookup, recipeChanges: [] });
            expect(itemNamed(items, 'fields', 'Sub_Rating__c')).toMatchObject({ recipeNote: OBJECT_REFRESH_RECIPE_NOTES.dependentPicklist, recipeChanges: [] });
            expect(itemNamed(items, 'fields', 'Mystery__c')).toMatchObject({ recipeNote: OBJECT_REFRESH_RECIPE_NOTES.noExpression, recipeChanges: [] });

        });

        it('leaves the recipe line of a pinned field, and of every field when the object has record type sections', async () => {

            const pinned = await compare({ kinds: ['fields'] }, { pinnedFieldApiNames: new Set(['Legacy_Code__c']) });
            expect(itemNamed(pinned.items, 'fields', 'Legacy_Code__c')).toMatchObject({ recipeNote: OBJECT_REFRESH_RECIPE_NOTES.pinned, recipeChanges: [] });
            expect(itemNamed(pinned.items, 'fields', 'Is_Priority__c')!.recipeChanges).toHaveLength(1);

            const sectionedRecipe = RECIPE_BY_BACKEND.snowfakery.replace("    Rating__c: ${{ random_choice('Hot','Warm','Cold') }}", [
                '    Rating__c: ',
                '        ### TODO: -- RecordType Options -- Business',
                "        ${{ random_choice('Hot','Warm') }}"
            ].join('\n'));
            const sectioned = await compare({ kinds: ['fields'] }, { recipeText: sectionedRecipe });
            expect(sectioned.items.every(item => item.recipeChanges.length === 0 && item.recipeNote === OBJECT_REFRESH_RECIPE_NOTES.recordTypeSections)).toBe(true);

        });

        it('changes only project files when the backend is not known or the recipe has no block for the object', async () => {

            const noBackend = await compare({ kinds: ['fields'] }, { expressionSource: undefined });
            expect(noBackend.items.every(item => item.recipeChanges.length === 0 && item.recipeNote === OBJECT_REFRESH_RECIPE_NOTES.noBackend)).toBe(true);

            const noBlock = await compare({ kinds: ['fields'] }, { recipeText: RECIPE_BY_BACKEND.snowfakery.replace('- object: Account', '- object: Lead') });
            expect(noBlock.items.every(item => item.recipeChanges.length === 0 && item.recipeNote === OBJECT_REFRESH_RECIPE_NOTES.notInRecipe)).toBe(true);

        });

        it('lists nothing for a field only the project holds, and reads no staged file through a link', async () => {

            fs.writeFileSync(projectPath('objects', 'Account', 'fields', 'Project_Only__c.field-meta.xml'), '<CustomField><fullName>Project_Only__c</fullName><type>Text</type></CustomField>');
            fs.rmSync(stagedPath('objects', 'Account', 'fields', 'Is_Priority__c.field-meta.xml'));
            fs.symlinkSync(projectPath('objects', 'Account', 'fields', 'Legacy_Code__c.field-meta.xml'), stagedPath('objects', 'Account', 'fields', 'Is_Priority__c.field-meta.xml'));

            const { items } = await compare({ kinds: ['fields'] });

            expect(items.map(item => item.name)).not.toIncludeAnyMembers(['Project_Only__c', 'Is_Priority__c']);

        });

    });

    describe('compareStagedObject, validation rules', () => {

        it('lists new and changed rules, counts unchanged ones, and copies a new one into the object\'s validationRules folder', async () => {

            fs.writeFileSync(projectPath('objects', 'Account', 'validationRules', 'Score_Max.validationRule-meta.xml'),
                fs.readFileSync(stagedPath('objects', 'Account', 'validationRules', 'Score_Max.validationRule-meta.xml'), 'utf-8').replace('Score__c &gt; 500', 'Score__c &gt; 900'));

            const { items, unchangedCountByKind } = await compare({ kinds: ['validationRules'] });

            expect(items.map(item => `${item.status} ${item.name}`)).toEqual(['new Legacy_Inactive', 'changed Score_Max', 'new Two_Fields']);
            expect(unchangedCountByKind.validationRules).toBe(1);
            expect(itemNamed(items, 'validationRules', 'Score_Max')!.differences).toEqual(['errorConditionFormula: Score__c > 900 → Score__c > 500']);
            expect(itemNamed(items, 'validationRules', 'Two_Fields')!.fileCopy.targetFilePath).toBe(projectPath('objects', 'Account', 'validationRules', 'Two_Fields.validationRule-meta.xml'));

        });

        // THE RECIPE WITH A Score__c LINE, SO A RULE ON IT HAS A LINE TO REWRITE
        const recipeWithScore = (backend: Backend) => RECIPE_BY_BACKEND[backend].replace('    Regions__c: ### TODO -- NO PICKLIST VALUES\n', '    Regions__c: ### TODO -- NO PICKLIST VALUES\n    Score__c: ${{ old }}\n');

        it.each(BACKENDS)('rewrites the line of the field an active single-field rule constrains in the %s backend, and says why any other rule changes the project only', async (backend) => {

            const { items } = await compare({ kinds: ['validationRules'] }, { recipeText: recipeWithScore(backend) }, backend);

            expect(itemNamed(items, 'validationRules', 'Score_Max')).toMatchObject({
                recipeNote: 'Rewrites the recipe line of Score__c.',
                recipeChanges: [{ operation: 'replace', fieldApiName: 'Score__c' }]
            });
            expect(itemNamed(items, 'validationRules', 'Score_Max')!.recipeChanges[0].valueText).toContain(backend === 'faker-js' ? 'faker.number.int({min: 0, max: 500})' : 'random_int(min=0, max=500)');
            expect(itemNamed(items, 'validationRules', 'Score_Max')!.recipeChanges[0].valueText).toContain('### Driven by ValidationRule "Score_Max"');
            expect(itemNamed(items, 'validationRules', 'Legacy_Inactive')).toMatchObject({ detail: 'Inactive', recipeNote: OBJECT_REFRESH_RECIPE_NOTES.ruleInactive, recipeChanges: [] });
            expect(itemNamed(items, 'validationRules', 'Two_Fields')!.recipeNote).toStartWith('Not a rule a recipe can apply: ');
            expect(itemNamed(items, 'validationRules', 'Two_Fields')!.recipeChanges).toEqual([]);

        });

        it('never adds a line for a field the recipe lacks, so the recipe never names what the project lacks: it points at the field item instead', async () => {

            const { items } = await compare({ kinds: ['validationRules'] });

            expect(itemNamed(items, 'validationRules', 'Score_Max')).toMatchObject({
                recipeNote: 'Score__c is not in the recipe: only the project file changes. Tick Score__c under Fields to add it with this rule applied.',
                recipeChanges: []
            });

        });

        it.each(BACKENDS)('writes a field\'s own line in the %s backend with its active rules in the org applied, unless they are switched off on its row', async (backend) => {

            const constrained = await compare({ kinds: ['fields'] }, {}, backend);
            expect(itemNamed(constrained.items, 'fields', 'Score__c')!.recipeChanges[0].valueText).toContain('### Driven by ValidationRule "Score_Max"');

            const rulesOff = await compare({ kinds: ['fields'] }, { validationRulesOffFieldApiNames: new Set(['Score__c']) }, backend);
            expect(itemNamed(rulesOff.items, 'fields', 'Score__c')!.recipeChanges[0].valueText).not.toContain('Driven by');

        });

        it('leaves the field\'s line when its rules are switched off on its row, or it is pinned', async () => {

            const rulesOff = await compare({ kinds: ['validationRules'] }, { recipeText: recipeWithScore('snowfakery'), validationRulesOffFieldApiNames: new Set(['Score__c']) });
            expect(itemNamed(rulesOff.items, 'validationRules', 'Score_Max')).toMatchObject({ recipeNote: OBJECT_REFRESH_RECIPE_NOTES.rulesOff, recipeChanges: [] });

            const pinned = await compare({ kinds: ['validationRules'] }, { recipeText: recipeWithScore('snowfakery'), pinnedFieldApiNames: new Set(['Score__c']) });
            expect(itemNamed(pinned.items, 'validationRules', 'Score_Max')).toMatchObject({ recipeNote: `Score__c: ${OBJECT_REFRESH_RECIPE_NOTES.pinned}`, recipeChanges: [] });

        });

    });

    describe('compareStagedObject, record types and global value sets', () => {

        it('lists a new and a changed record type by their picklist values, each pointing at Generate Treecipe and no recipe line', async () => {

            const { items } = await compare({ kinds: ['recordTypes'] });

            expect(items.map(item => `${item.status} ${item.name}`)).toEqual(['changed Business', 'new Partner']);
            expect(itemNamed(items, 'recordTypes', 'Business')).toMatchObject({ differences: ['Rating__c: +Cold'], recipeNote: OBJECT_REFRESH_RECIPE_NOTES.recordType, recipeChanges: [], offersRecordTypeRegenerate: true });
            expect(itemNamed(items, 'recordTypes', 'Partner')!.fileCopy.targetFilePath).toBe(projectPath('objects', 'Account', 'recordTypes', 'Partner.recordType-meta.xml'));

        });

        it.each(BACKENDS)('lists a changed global value set by its active values and rewrites each %s picklist line that uses it', async (backend) => {

            const { items } = await compare({ kinds: ['globalValueSets'] }, {}, backend);

            expect(items).toHaveLength(1);
            expect(items[0]).toMatchObject({
                kind: 'globalValueSets',
                name: 'Regions',
                status: 'changed',
                detail: '3 values',
                differences: ['values: +North'],
                recipeNote: 'Rewrites the recipe line of Regions__c.',
                recipeChanges: [{
                    operation: 'replace',
                    fieldApiName: 'Regions__c',
                    valueText: backend === 'faker-js' ? '${{ faker.helpers.arrayElement([`East`,`West`,`North`]) }}' : "${{ random_choice('East', 'West', 'North') }}"
                }]
            });
            expect(items[0].fileCopy.targetFilePath).toBe(projectPath('globalValueSets', 'Regions.globalValueSet-meta.xml'));

        });

        it('lists no global value set the object does not use, and copies a new one into the default package directory', async () => {

            fs.rmSync(projectPath('globalValueSets', 'Regions.globalValueSet-meta.xml'));
            fs.copyFileSync(stagedPath('globalValueSets', 'Regions.globalValueSet-meta.xml'), stagedPath('globalValueSets', 'Zones.globalValueSet-meta.xml'));

            const { items } = await compare({ kinds: ['globalValueSets'] });

            expect(items.map(item => `${item.status} ${item.name}`)).toEqual(['new Regions']);
            expect(items[0].fileCopy.targetFilePath).toBe(projectPath('globalValueSets', 'Regions.globalValueSet-meta.xml'));

        });

        it('lists only the kinds ticked', async () => {
            const { items } = await compare({ kinds: ['recordTypes', 'globalValueSets'] });
            expect([...new Set(items.map(item => item.kind))]).toEqual(['recordTypes', 'globalValueSets']);
        });

    });

    describe('compareStagedObject, what it cannot read or finds the same', () => {

        it('counts a validation rule or record type file either side cannot read, and lists no other kind', async () => {

            fs.writeFileSync(stagedPath('objects', 'Account', 'validationRules', 'Score_Max.validationRule-meta.xml'), '<ValidationRule><fullName>Score_Max');
            fs.writeFileSync(projectPath('objects', 'Account', 'recordTypes', 'Business.recordType-meta.xml'), '<NotARecordType/>');

            const { items, unreadableCountByKind } = await compare({ kinds: ['validationRules', 'recordTypes'] });

            expect(unreadableCountByKind).toEqual({ fields: 0, validationRules: 1, recordTypes: 1, globalValueSets: 0 });
            expect(items.map(item => item.name)).toEqual(['Legacy_Inactive', 'Two_Fields', 'Partner']);

        });

        it('counts a record type with the same values as unchanged, and names one whose label and active state changed', async () => {

            fs.copyFileSync(stagedPath('objects', 'Account', 'recordTypes', 'Business.recordType-meta.xml'), projectPath('objects', 'Account', 'recordTypes', 'Business.recordType-meta.xml'));
            fs.writeFileSync(projectPath('objects', 'Account', 'recordTypes', 'Partner.recordType-meta.xml'),
                fs.readFileSync(stagedPath('objects', 'Account', 'recordTypes', 'Partner.recordType-meta.xml'), 'utf-8').replace('<active>true</active>', '<active>false</active>').replace('<label>Partner</label>', '<label>Old Partner</label>'));

            const { items, unchangedCountByKind } = await compare({ kinds: ['recordTypes'] });

            expect(unchangedCountByKind.recordTypes).toBe(1);
            expect(items.map(item => [item.name, item.differences])).toEqual([['Partner', ['active: false → true', 'label: Old Partner → Partner']]]);

        });

        it('counts a global value set that is the same, or that either side cannot read', async () => {

            fs.copyFileSync(stagedPath('globalValueSets', 'Regions.globalValueSet-meta.xml'), projectPath('globalValueSets', 'Regions.globalValueSet-meta.xml'));
            const same = await compare({ kinds: ['globalValueSets'] });
            expect(same.items).toEqual([]);
            expect(same.unchangedCountByKind.globalValueSets).toBe(1);

            fs.writeFileSync(projectPath('globalValueSets', 'Regions.globalValueSet-meta.xml'), '<GlobalValueSet>');
            expect((await compare({ kinds: ['globalValueSets'] })).unreadableCountByKind.globalValueSets).toBe(1);

            fs.writeFileSync(stagedPath('globalValueSets', 'Regions.globalValueSet-meta.xml'), '<NotAValueSet/>');
            expect((await compare({ kinds: ['globalValueSets'] })).unreadableCountByKind.globalValueSets).toBe(1);

        });

        it('names five values a list gained or lost and counts the rest', async () => {

            const manyValues = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
            fs.writeFileSync(stagedPath('globalValueSets', 'Regions.globalValueSet-meta.xml'), [
                '<GlobalValueSet xmlns="http://soap.sforce.com/2006/04/metadata">',
                ...manyValues.map(value => `    <customValue><fullName>${value}</fullName><label>${value}</label></customValue>`),
                '</GlobalValueSet>'
            ].join('\n'));

            const { items } = await compare({ kinds: ['globalValueSets'] });

            expect(items[0].differences).toEqual(['values: +A, +B, +C, +D, +E, and 4 more']);

        });

        it('says why a picklist line using a changed global value set is not rewritten', async () => {

            const { items } = await compare({ kinds: ['globalValueSets'] }, { pinnedFieldApiNames: new Set(['Regions__c']) });

            expect(items[0]).toMatchObject({ recipeNote: `Regions__c: ${OBJECT_REFRESH_RECIPE_NOTES.pinned}`, recipeChanges: [] });

        });

        it('says no recipe line uses a changed global value set when no field of the recipe does', async () => {

            const { items } = await compare({ kinds: ['globalValueSets'] }, { recipeText: RECIPE_BY_BACKEND.snowfakery.replace('    Regions__c: ### TODO -- NO PICKLIST VALUES\n', '') });

            expect(items[0]).toMatchObject({ recipeNote: OBJECT_REFRESH_RECIPE_NOTES.noFieldUsesValueSet, recipeChanges: [] });

        });

        it('changes only project files when there is no recipe text at all', async () => {

            const { items } = await compare({ kinds: ['fields'] }, { recipeText: undefined });

            expect(items.every(item => item.recipeChanges.length === 0 && item.recipeNote === OBJECT_REFRESH_RECIPE_NOTES.notInRecipe)).toBe(true);

        });

        it('lists nothing when the org returned nothing for the object', async () => {

            fs.rmSync(stagingFolderPath, { recursive: true, force: true });
            fs.mkdirSync(stagingFolderPath, { recursive: true });

            const comparison = await compare();

            expect(comparison.isRetrieved).toBe(false);
            expect(comparison.items).toEqual([]);

        });

    });

    describe('applyRecipeChanges', () => {

        it.each(BACKENDS)('writes only the ticked items\' lines into a %s recipe, every other line byte-identical', async (backend) => {

            const { items } = await compare({}, {}, backend);
            const ticked = items.filter(item => ['Is_Priority__c', 'Score__c', 'Regions'].includes(item.name));
            const recipeText = RECIPE_BY_BACKEND[backend];

            const outcome = RecipeCockpitObjectRefresh.applyRecipeChanges(recipeText, 'Account', undefined, ticked);

            expect(outcome.refusals).toEqual([]);
            expect(outcome.writtenLineCount).toBe(3);
            const writtenLines = outcome.recipeText.split('\n');
            const untouchedLines = recipeText.split('\n').filter(recipeLine => !recipeLine.startsWith('    Regions__c:'));
            expect(writtenLines).toIncludeAllMembers(untouchedLines);
            expect(writtenLines.filter(writtenLine => !recipeText.split('\n').includes(writtenLine)).map(writtenLine => writtenLine.trim().split(':')[0])).toEqual(['Regions__c', 'Is_Priority__c', 'Score__c', '### Driven by ValidationRule "Score_Max"']);
            expect(outcome.recipeText).toContain('Legacy_Code__c: ' + recipeText.split('Legacy_Code__c: ')[1].split('\n')[0]);
            expect(() => yaml.load(outcome.recipeText)).not.toThrow();

        });

        it('writes a rule\'s constrained value over the field\'s plain one when both are ticked, whatever order they come in', async () => {

            const { items } = await compare();
            const scoreField = itemNamed(items, 'fields', 'Score__c')!;
            const scoreRule = itemNamed(items, 'validationRules', 'Score_Max')!;

            const outcome = RecipeCockpitObjectRefresh.applyRecipeChanges(RECIPE_BY_BACKEND.snowfakery, 'Account', undefined, [scoreRule, scoreField]);

            expect(outcome.refusals).toEqual([]);
            expect(outcome.recipeText).toContain('    Score__c: "${{fake.random_int(min=0, max=500)}}"');
            expect(outcome.recipeText.match(/Score__c:/g)).toHaveLength(1);

        });

        it('names a line it cannot write and still writes the rest', async () => {

            const { items } = await compare({ kinds: ['fields'] });
            const recipeWithoutLegacy = RECIPE_BY_BACKEND.snowfakery.replace('    Legacy_Code__c: ${{fake.Word}}\n', '');
            const misplaced: IObjectRefreshPlannedItem = { ...itemNamed(items, 'fields', 'Is_Priority__c')!, recipeChanges: [{ operation: 'insert', fieldApiName: 'Bad Name', valueText: '${{fake.Word}}' }] };

            const outcome = RecipeCockpitObjectRefresh.applyRecipeChanges(recipeWithoutLegacy, 'Account', undefined, [misplaced, itemNamed(items, 'fields', 'Legacy_Code__c')!]);

            expect(outcome.writtenLineCount).toBe(1);
            expect(outcome.refusals).toHaveLength(1);
            expect(outcome.refusals[0]).toStartWith('Account.Bad Name: ');
            expect(outcome.recipeText).toContain('Legacy_Code__c: ${{fake.text(max_nb_chars=255)}}');

        });

        describe.each(BACKENDS)('a hostile global value set value in a %s recipe', (backend) => {

            it.each(QUOTE_PAYLOADS)('%s reaches the recipe escaped, as one value of one field', async (_payloadName, hostileValue) => {

                const escapedXmlValue = hostileValue.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                fs.writeFileSync(stagedPath('globalValueSets', 'Regions.globalValueSet-meta.xml'), [
                    '<GlobalValueSet xmlns="http://soap.sforce.com/2006/04/metadata">',
                    `    <customValue><fullName>${escapedXmlValue}</fullName><label>x</label></customValue>`,
                    '    <masterLabel>Regions</masterLabel>',
                    '</GlobalValueSet>'
                ].join('\n'));

                const { items } = await compare({ kinds: ['globalValueSets'] }, {}, backend);
                const outcome = RecipeCockpitObjectRefresh.applyRecipeChanges(RECIPE_BY_BACKEND[backend], 'Account', undefined, items);
                const loadedAccount = ( yaml.load(outcome.recipeText) as Array<{ object: string; fields: Record<string, unknown> }> )[0];

                expect(outcome.refusals).toEqual([]);
                expect(Object.keys(loadedAccount.fields)).toEqual(['Name', 'Legacy_Code__c', 'Annual_Budget__c', 'Rating__c', 'Regions__c']);
                expect(loadedAccount.fields).not.toHaveProperty(INJECTED_FIELD_API_NAME);
                expect(typeof loadedAccount.fields.Regions__c).toBe('string');

            });

        });

    });

});
