import * as fs from 'fs';
import * as path from 'path';

import {
    RECIPE_COCKPIT_QUERY_MAX_LENGTH,
    RECIPE_COCKPIT_QUERY_PREVIEW_CELL_MAX_LENGTH,
    RecipeCockpitQuery
} from '../RecipeCockpitQuery';
import { SOQLTemplateService } from '../../SOQLTemplateService/SOQLTemplateService';
import { ObjectInfoWrapper } from '../../ObjectInfoWrapper/ObjectInfoWrapper';

import * as matchers from 'jest-extended';
expect.extend(matchers);

const TREE_WRAPPER_FILE_PATH = path.join(__dirname, 'mocks', 'treeWorkspace', 'treecipe', 'GeneratedRecipes', 'recipe-2026-09-20T10-00-00', 'treecipeObjectsWrapper-2026-09-20T10-00-00.json');

const readTreeWrapper = (): unknown => JSON.parse(fs.readFileSync(TREE_WRAPPER_FILE_PATH, 'utf-8'));

describe('RecipeCockpitQuery.listTreeQueries (#367)', () => {

    it('lists the queries the tree markdown holds, from the wrapper JSON Generate Treecipe wrote', () => {

        const parsedWrapper = readTreeWrapper();
        const treeObjectApiNames = ['Account', 'Contact', 'OtherChildObject__c'];
        const treeQueries = RecipeCockpitQuery.listTreeQueries(parsedWrapper, treeObjectApiNames);
        const markdown = SOQLTemplateService.generateSOQLTemplateMarkdownForTree(parsedWrapper as ObjectInfoWrapper, treeObjectApiNames, 'ts');

        expect(treeQueries.map(treeQuery => treeQuery.queryKey)).toIncludeAllMembers([
            'Account:base:0',
            'Account:childToParent:0',
            'Account:parentToChild:0',
            'Account:recordType:0',
            'Account:recordType:1',
            'Contact:base:0',
            'Contact:childToParent:0',
            'OtherChildObject__c:base:0'
        ]);
        treeQueries.forEach(treeQuery => {
            expect(markdown).toContain([...treeQuery.notes.map(note => `-- ${note}`), treeQuery.text].join('\n'));
        });

    });

    it('reads nothing it cannot type-check, and keeps no object named after a prototype member or a non api name', () => {

        const hostileWrapper = JSON.parse(JSON.stringify({
            ObjectToObjectInfoMap: {
                'Evil\nDELETE': { Fields: [{ fieldName: 'Name', type: 'Text' }] },
                Account: {
                    Fields: [{ fieldName: 7, type: 'Text' }, 'not a field', { fieldName: 'Name', type: 'Text' }],
                    RelationshipDetail: { childObjectToFieldReferences: { constructor: 'AccountId', Contact: ['AccountId', 5] } },
                    RecordTypesMap: 'nope'
                },
                Contact: { Fields: 'nope' }
            }
        }));
        const treeQueries = RecipeCockpitQuery.listTreeQueries(hostileWrapper, ['Account', 'Contact', 'Evil\nDELETE', '__proto__']);

        expect(treeQueries.map(treeQuery => treeQuery.queryKey)).toEqual(['Account:base:0', 'Account:parentToChild:0', 'Contact:base:0']);
        expect(treeQueries[0].text).toBe('SELECT Id,\n       Name\nFROM Account');
        expect(RecipeCockpitQuery.listTreeQueries('not a wrapper', ['Account'])).toEqual([]);

    });

});

describe('RecipeCockpitQuery.checkQueryText (#367)', () => {

    it('accepts one SELECT, trimmed, with semicolons and quotes inside a quoted value', () => {

        expect(RecipeCockpitQuery.checkQueryText('  select Id FROM Account\n  WHERE Name = \'a;b\\\'c\'  ')).toEqual({ query: 'select Id FROM Account\n  WHERE Name = \'a;b\\\'c\'' });

    });

    it.each([
        [42, 'not text'],
        ['   ', 'empty'],
        ['DELETE FROM Account', 'SELECT statement'],
        ['SELECTId FROM Account', 'SELECT statement'],
        ['SELECT Id FROM Account; SELECT Id FROM Contact', 'one statement'],
        ['SELECT Id FROM Account WHERE Name = \'open', 'never closed'],
        ['SELECT Id FROM Account WHERE Id = null', 'control character'],
        ['SELECT Id FROM Account\u0000', 'control character'],
        ['SELECT ' + 'x'.repeat(RECIPE_COCKPIT_QUERY_MAX_LENGTH), `at most ${RECIPE_COCKPIT_QUERY_MAX_LENGTH}`]
    ])('refuses %p', (candidateText, expectedRefusal) => {

        const queryCheck = RecipeCockpitQuery.checkQueryText(candidateText);
        expect('refusal' in queryCheck && queryCheck.refusal).toContain(expectedRefusal);

    });

});

describe('RecipeCockpitQuery.fetchQueryRecords (#367)', () => {

    const buildPages = (pageCount: number, pageSize: number) => {
        const pages = Array.from({ length: pageCount }, (_unused, pageIndex) => ({
            totalSize: pageCount * pageSize,
            done: pageIndex === pageCount - 1,
            records: Array.from({ length: pageSize }, (_record, recordIndex) => ({ attributes: { type: 'Account' }, Name: `A${pageIndex * pageSize + recordIndex}` })),
            ...( pageIndex < pageCount - 1 ? { nextRecordsUrl: `/next/${pageIndex + 1}` } : {} )
        }));
        const query = jest.fn(async () => pages[0]);
        const queryMore = jest.fn(async (nextRecordsUrl: string) => pages[Number(nextRecordsUrl.split('/').pop())]);
        return { query, queryMore };
    };

    it('reads every page until the org says it is done', async () => {

        const pageSource = buildPages(3, 4);
        const queryResult = await RecipeCockpitQuery.fetchQueryRecords(pageSource, 'SELECT Name FROM Account');

        expect(queryResult.records.map(record => record.Name)).toEqual(Array.from({ length: 12 }, (_unused, index) => `A${index}`));
        expect(queryResult).toMatchObject({ totalSize: 12, isTruncated: false, isCancelled: false });
        expect(pageSource.queryMore).toHaveBeenCalledTimes(2);

    });

    it('stops at the cap, says it was truncated and reads no page past it', async () => {

        const pageSource = buildPages(5, 4);
        const queryResult = await RecipeCockpitQuery.fetchQueryRecords(pageSource, 'SELECT Name FROM Account', 6);

        expect(queryResult.records).toHaveLength(6);
        expect(queryResult).toMatchObject({ totalSize: 20, isTruncated: true });
        expect(pageSource.queryMore).toHaveBeenCalledTimes(1);

    });

    it('stops between pages when the reader cancels', async () => {

        const pageSource = buildPages(3, 2);
        const queryResult = await RecipeCockpitQuery.fetchQueryRecords(pageSource, 'SELECT Name FROM Account', 100, () => true);

        expect(queryResult).toMatchObject({ isCancelled: true, isTruncated: false });
        expect(queryResult.records).toHaveLength(2);
        expect(pageSource.queryMore).not.toHaveBeenCalled();

    });

    it('throws on an answer it cannot read, never reading it as no records', async () => {

        await expect(RecipeCockpitQuery.fetchQueryRecords({ query: async () => ({ totalSize: 3 }), queryMore: jest.fn() }, 'SELECT Id FROM Account')).rejects.toThrow('could not be read');
        await expect(RecipeCockpitQuery.fetchQueryRecords({ query: async () => ({ done: false, records: [] }), queryMore: jest.fn() }, 'SELECT Id FROM Account')).rejects.toThrow('named no page');

    });

});

describe('RecipeCockpitQuery exports (#367)', () => {

    const records: Record<string, unknown>[] = [
        {
            attributes: { type: 'Contact', url: '/x' },
            Id: '003000000000001AAA',
            LastName: 'O"Brien, Jr.',
            Account: { attributes: { type: 'Account' }, Name: '=HYPERLINK("http://x")', Owner: { attributes: {}, Alias: 'jd' } },
            Cases: { totalSize: 1, done: true, records: [{ attributes: { type: 'Case' }, Subject: 'Help' }] },
            Amount__c: -5
        },
        {
            attributes: { type: 'Contact' },
            Id: '003000000000002AAA',
            LastName: 'Line\nBreak',
            Account: null,
            Cases: null,
            Amount__c: null,
            Extra__c: true
        }
    ];

    it('writes JSON as the records without attributes, a subquery as its records', () => {

        expect(JSON.parse(RecipeCockpitQuery.buildJsonExport(records))).toEqual([
            {
                Id: '003000000000001AAA',
                LastName: 'O"Brien, Jr.',
                Account: { Name: '=HYPERLINK("http://x")', Owner: { Alias: 'jd' } },
                Cases: [{ Subject: 'Help' }],
                Amount__c: -5
            },
            { Id: '003000000000002AAA', LastName: 'Line\nBreak', Account: null, Cases: null, Amount__c: null, Extra__c: true }
        ]);

    });

    it('writes CSV with dotted parent columns, a subquery as JSON, RFC 4180 quoting and no formula a spreadsheet would run', () => {

        expect(RecipeCockpitQuery.buildCsvExport(records)).toBe([
            'Id,LastName,Account.Name,Account.Owner.Alias,Cases,Amount__c,Account,Extra__c',
            '003000000000001AAA,"O""Brien, Jr.","\'=HYPERLINK(""http://x"")",jd,"[{""Subject"":""Help""}]",-5,,',
            '003000000000002AAA,"Line\nBreak",,,,,,true',
            ''
        ].join('\r\n'));

    });

    it('writes an empty header line for no records, and keeps a __proto__ key as a key rather than a prototype', () => {

        expect(RecipeCockpitQuery.buildCsvExport([])).toBe('\r\n');
        const prototypeRecord = JSON.parse('{"__proto__": {"Polluted": 1}, "Id": "1"}');
        expect(JSON.parse(RecipeCockpitQuery.buildJsonExport([prototypeRecord]))).toEqual(JSON.parse('[{"__proto__": {"Polluted": 1}, "Id": "1"}]'));
        expect(({} as Record<string, unknown>).Polluted).toBeUndefined();

    });

    it('previews at most the row limit, as text, with long cells cut', () => {

        const manyRecords = Array.from({ length: 80 }, (_unused, index) => ({ Id: String(index), Description: 'd'.repeat(RECIPE_COCKPIT_QUERY_PREVIEW_CELL_MAX_LENGTH + 10) }));
        const preview = RecipeCockpitQuery.buildPreview(manyRecords, 50);

        expect(preview.columns).toEqual(['Id', 'Description']);
        expect(preview.rows).toHaveLength(50);
        expect(preview.rows[0][1]).toHaveLength(RECIPE_COCKPIT_QUERY_PREVIEW_CELL_MAX_LENGTH + 1);
        expect(RecipeCockpitQuery.buildPreview(records).rows[1]).toEqual(['003000000000002AAA', 'Line\nBreak', '', '', '', '', '', 'true']);

    });

});

describe('RecipeCockpitQuery.writeQueryExport (#367)', () => {

    let temporaryRoot: string;
    let workspaceRoot: string;
    const exportDate = new Date(2026, 9, 18, 9, 5, 7);

    beforeEach(() => {
        temporaryRoot = fs.mkdtempSync(path.join(require('os').tmpdir(), 'treecipe-query-export-'));
        workspaceRoot = path.join(temporaryRoot, 'workspace');
        fs.mkdirSync(workspaceRoot);
    });

    afterEach(() => {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    });

    const write = (treeFolderName = 'Account-thru-Contact', objectApiName = 'Account') =>
        RecipeCockpitQuery.writeQueryExport(workspaceRoot, treeFolderName, objectApiName, 'base', 'csv', 'Id\r\n', exportDate);

    it('writes under treecipe/QueryResults/<folder> with a timestamped name, a git ignore beside it, and the next free suffix after that', () => {

        const firstPath = write();
        const secondPath = write();

        expect(firstPath).toBe(path.join(workspaceRoot, 'treecipe', 'QueryResults', 'Account-thru-Contact', '20261018-090507-Account-base.csv'));
        expect(secondPath).toBe(path.join(workspaceRoot, 'treecipe', 'QueryResults', 'Account-thru-Contact', '20261018-090507-Account-base-2.csv'));
        expect(fs.readFileSync(firstPath as string, 'utf-8')).toBe('Id\r\n');
        expect(fs.readFileSync(path.join(workspaceRoot, 'treecipe', 'QueryResults', '.gitignore'), 'utf-8')).toBe('*\n');

    });

    it.each([
        ['', 'Account'],
        ['..', 'Account'],
        ['a/b', 'Account'],
        ['a\\b', 'Account'],
        ['Tree', 'Not An Api Name']
    ])('writes nothing for the folder %p and object %p', (treeFolderName, objectApiName) => {

        expect(write(treeFolderName, objectApiName)).toBeUndefined();
        expect(fs.existsSync(path.join(workspaceRoot, 'treecipe'))).toBe(false);

    });

    it('writes nothing through a link out of the workspace, or where a folder cannot be made', () => {

        const outsidePath = path.join(temporaryRoot, 'outside');
        fs.mkdirSync(outsidePath);
        fs.mkdirSync(path.join(workspaceRoot, 'treecipe'));
        fs.symlinkSync(outsidePath, path.join(workspaceRoot, 'treecipe', 'QueryResults'));

        expect(write()).toBeUndefined();
        expect(fs.readdirSync(outsidePath)).toEqual([]);

        fs.rmSync(path.join(workspaceRoot, 'treecipe', 'QueryResults'));
        fs.writeFileSync(path.join(workspaceRoot, 'treecipe', 'QueryResults'), 'a file, not a folder');
        expect(write()).toBeUndefined();

    });

    it('checks the folder again once it is made, writes nothing when the write fails, and stops after its suffixes', () => {

        const containmentSpy = jest.spyOn(require('../../SfdxProjectService/SfdxProjectService').SfdxProjectService, 'isPathContainedInWorkspace');
        containmentSpy.mockReturnValueOnce(true).mockReturnValueOnce(false);
        expect(write()).toBeUndefined();
        containmentSpy.mockRestore();

        const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => { throw Object.assign(new Error('read-only'), { code: 'EROFS' }); });
        expect(write()).toBeUndefined();
        writeSpy.mockImplementation(() => { throw Object.assign(new Error('exists'), { code: 'EEXIST' }); });
        expect(write()).toBeUndefined();
        writeSpy.mockRestore();

    });

});

describe('RecipeCockpitQuery values the org answers as arrays or objects (#367)', () => {

    it('keeps an array value as an array in JSON, and writes it, or any object left, as JSON text in a cell', () => {

        const records = [{ attributes: { type: 'Thing__c' }, Tags__c: ['a', { attributes: {}, b: 1 }] }];

        expect(JSON.parse(RecipeCockpitQuery.buildJsonExport(records))).toEqual([{ Tags__c: ['a', { b: 1 }] }]);
        expect(RecipeCockpitQuery.buildPreview(records).rows).toEqual([['["a",{"attributes":{},"b":1}]']]);

    });

});
