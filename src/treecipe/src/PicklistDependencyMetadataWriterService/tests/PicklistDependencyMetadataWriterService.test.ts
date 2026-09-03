import { PicklistDependencyMetadataWriterService } from "../PicklistDependencyMetadataWriterService";
import { IPicklistDependencySpecDetail } from "../../PicklistDependencyTestService/PicklistDependencyTestService";

import * as fs from 'fs';
import * as path from 'path';

import * as matchers from 'jest-extended';
expect.extend(matchers);

jest.mock('vscode', () => ({}), { virtual: true });

const mocksDirectoryPath = path.join(__dirname, 'mocks');

const readMock = (fileName: string) => fs.readFileSync(path.join(mocksDirectoryPath, fileName), 'utf-8');

describe('PicklistDependencyMetadataWriterService', () => {

    describe('reading valueSettings out of a field file', () => {

        it('reads the grouped shape, where one block carries every controlling value', () => {

            const blocks = PicklistDependencyMetadataWriterService.collectValueSettingsBlocks(readMock('GroupedShape.field-meta.xml'));

            expect(blocks).toHaveLength(2);
            expect(blocks[0].valueName).toBe('tree');
            expect(blocks[0].controllingValues).toEqual(['cle', 'eastlake', 'madison']);
            expect(PicklistDependencyMetadataWriterService.resolveValueSettingsShape(blocks)).toBe('grouped');

        });

        it('reads the flat shape, where each block is one pair', () => {

            const blocks = PicklistDependencyMetadataWriterService.collectValueSettingsBlocks(readMock('FlatShape.field-meta.xml'));

            expect(blocks).toHaveLength(3);
            expect(blocks.map(block => block.valueName)).toEqual(['ohiocity', 'tremont', 'willowick']);
            expect(PicklistDependencyMetadataWriterService.resolveValueSettingsShape(blocks)).toBe('flat');

        });

        it('decodes xml entities in values rather than carrying the markup through', () => {

            const blocks = PicklistDependencyMetadataWriterService.collectValueSettingsBlocks(readMock('SpecialCharacters.field-meta.xml'));

            expect(blocks.map(block => block.valueName)).toContain(`Tom & Jerry's`);

        });

        it('reports the region and the indentation the blocks are written at', () => {

            const region = PicklistDependencyMetadataWriterService.resolveValueSettingsRegion(readMock('FlatShape.field-meta.xml'));

            expect(region.indentation).toBe('        ');
            expect(region.blocks).toHaveLength(3);

        });

        /*
            Replacing a span with unrelated markup interleaved between blocks would delete it.
            Salesforce never emits them that way, so refusing costs nothing and protects the one
            file that is unusual.
        */
        it('given markup interleaved between blocks, refuses the region rather than risking a delete', () => {

            const interleavedContent = readMock('FlatShape.field-meta.xml')
                .replace('</valueSettings>\n        <valueSettings>', '</valueSettings>\n        <somethingElse>keep me</somethingElse>\n        <valueSettings>');

            expect(PicklistDependencyMetadataWriterService.resolveValueSettingsRegion(interleavedContent)).toBeUndefined();

        });

        it('given a field with no valueSettings at all, reports no region rather than throwing', () => {

            expect(PicklistDependencyMetadataWriterService.resolveValueSettingsRegion('<CustomField></CustomField>')).toBeUndefined();

        });

    });

    /*
        The transpose is the whole point of the command. A spec is indexed by CONTROLLING value and
        the metadata by DEPENDENT value, and getting that backwards is the mistake a human makes by
        hand -- so it is asserted directly rather than only through a file write.
    */
    describe('transposing a spec into dependent-indexed settings', () => {

        it('turns "cle unlocks ohiocity and tremont" into entries on ohiocity and tremont', () => {

            const specDetail: IPicklistDependencySpecDetail = {
                objectApiName: 'Dependency_Example__c',
                fieldApiName: 'Neighborhood__c',
                controllingFieldApiName: 'City__c',
                expectations: [
                    { controllingValue: 'cle', dependentValues: ['ohiocity', 'tremont'] },
                    { controllingValue: 'eastlake', dependentValues: ['willowick'] }
                ]
            };

            expect(PicklistDependencyMetadataWriterService.buildControllingValuesByDependentValue(specDetail)).toEqual({
                ohiocity: ['cle'],
                tremont: ['cle'],
                willowick: ['eastlake']
            });

        });

        it('merges a dependent value unlocked by more than one controlling value', () => {

            const specDetail: IPicklistDependencySpecDetail = {
                objectApiName: 'Example__c',
                fieldApiName: 'Dependent__c',
                controllingFieldApiName: 'Controlling__c',
                expectations: [
                    { controllingValue: 'cle', dependentValues: ['tree'] },
                    { controllingValue: 'eastlake', dependentValues: ['tree'] }
                ]
            };

            expect(PicklistDependencyMetadataWriterService.buildControllingValuesByDependentValue(specDetail).tree).toEqual(['cle', 'eastlake']);

        });

        it('ignores an unavailable controlling value, which says nothing about what the field declares', () => {

            const specDetail: IPicklistDependencySpecDetail = {
                objectApiName: 'Example__c',
                fieldApiName: 'Dependent__c',
                controllingFieldApiName: 'Controlling__c',
                expectations: [
                    { controllingValue: 'cle', dependentValues: [], controllingValueUnavailable: true },
                    { controllingValue: 'eastlake', dependentValues: ['tree'] }
                ]
            };

            expect(PicklistDependencyMetadataWriterService.buildControllingValuesByDependentValue(specDetail)).toEqual({ tree: ['eastlake'] });

        });

    });

    /*
        The merge semantics. A spec asserts what a controlling value MUST unlock and what it must
        NOT; anything it names neither way it makes no claim about. Reading those silences as
        removals would let a one-line hand written spec strip the rest of the file.
    */
    describe('applying spec intent to what the metadata already says', () => {

        const currentSettings = { ohiocity: ['cle'], tremont: ['cle'], willowick: ['eastlake'] };

        it('adds a dependent value the spec unlocks and the metadata does not', () => {

            const specDetail: IPicklistDependencySpecDetail = {
                objectApiName: 'Example__c',
                fieldApiName: 'Dependent__c',
                controllingFieldApiName: 'Controlling__c',
                expectations: [{ controllingValue: 'cle', dependentValues: ['ohiocity', 'tremont', 'plant'] }]
            };

            const desired = PicklistDependencyMetadataWriterService
                .buildDesiredControllingValuesByDependentValue(specDetail, currentSettings);

            expect(desired.plant).toEqual(['cle']);

        });

        it('removes a pair the spec forbids', () => {

            const specDetail: IPicklistDependencySpecDetail = {
                objectApiName: 'Example__c',
                fieldApiName: 'Dependent__c',
                controllingFieldApiName: 'Controlling__c',
                expectations: [{ controllingValue: 'cle', dependentValues: ['ohiocity'], forbiddenValues: ['tremont'] }]
            };

            const desired = PicklistDependencyMetadataWriterService
                .buildDesiredControllingValuesByDependentValue(specDetail, currentSettings);

            expect(desired.tremont).toBeEmpty();
            expect(desired.ohiocity).toEqual(['cle']);

        });

        it('leaves a controlling value the spec never mentions completely alone', () => {

            const specDetail: IPicklistDependencySpecDetail = {
                objectApiName: 'Example__c',
                fieldApiName: 'Dependent__c',
                controllingFieldApiName: 'Controlling__c',
                expectations: [{ controllingValue: 'cle', dependentValues: ['ohiocity'] }]
            };

            const desired = PicklistDependencyMetadataWriterService
                .buildDesiredControllingValuesByDependentValue(specDetail, currentSettings);

            // eastlake IS NOT NAMED BY THE SPEC, SO ITS ENTRY SURVIVES UNTOUCHED
            expect(desired.willowick).toEqual(['eastlake']);

        });

        /*
            expectNone is the strictly stronger claim -- "this controlling value unlocks nothing" --
            and it used to be the one that did nothing, because an empty dependent list is
            indistinguishable from silence unless the spec marks it exhaustive.
        */
        it('given expectNone, removes every entry for that controlling value', () => {

            const specDetail: IPicklistDependencySpecDetail = {
                objectApiName: 'Example__c',
                fieldApiName: 'Dependent__c',
                controllingFieldApiName: 'Controlling__c',
                expectations: [{ controllingValue: 'cle', dependentValues: [], dependentValuesAreExhaustive: true }]
            };

            const desired = PicklistDependencyMetadataWriterService
                .buildDesiredControllingValuesByDependentValue(specDetail, currentSettings);

            expect(desired.ohiocity).toBeEmpty();
            expect(desired.tremont).toBeEmpty();

            // A CONTROLLING VALUE THE CLAIM DOES NOT CONCERN IS UNTOUCHED
            expect(desired.willowick).toEqual(['eastlake']);

        });

        it('given expectExactly, narrows to exactly the values named', () => {

            const specDetail: IPicklistDependencySpecDetail = {
                objectApiName: 'Example__c',
                fieldApiName: 'Dependent__c',
                controllingFieldApiName: 'Controlling__c',
                expectations: [{ controllingValue: 'cle', dependentValues: ['ohiocity'], dependentValuesAreExhaustive: true }]
            };

            const desired = PicklistDependencyMetadataWriterService
                .buildDesiredControllingValuesByDependentValue(specDetail, currentSettings);

            expect(desired.ohiocity).toEqual(['cle']);
            expect(desired.tremont).toBeEmpty();
            expect(desired.willowick).toEqual(['eastlake']);

        });

        // WITHOUT THE FLAG THE SAME EMPTY LIST MUST STAY INERT -- SILENCE IS "NO CLAIM"
        it('given an empty dependent list that is NOT exhaustive, changes nothing', () => {

            const specDetail: IPicklistDependencySpecDetail = {
                objectApiName: 'Example__c',
                fieldApiName: 'Dependent__c',
                controllingFieldApiName: 'Controlling__c',
                expectations: [{ controllingValue: 'cle', dependentValues: [] }]
            };

            expect(PicklistDependencyMetadataWriterService
                .buildDesiredControllingValuesByDependentValue(specDetail, currentSettings)).toEqual(currentSettings);

        });

        it('given a dependent value that collides with an Object prototype key, does not throw', () => {

            const specDetail: IPicklistDependencySpecDetail = {
                objectApiName: 'Example__c',
                fieldApiName: 'Dependent__c',
                controllingFieldApiName: 'Controlling__c',
                expectations: [{ controllingValue: 'cle', dependentValues: ['toString', 'constructor'] }]
            };

            const desired = PicklistDependencyMetadataWriterService
                .buildDesiredControllingValuesByDependentValue(specDetail, { valueOf: ['eastlake'] });

            expect(desired.toString).toEqual(['cle']);
            expect(desired.constructor).toEqual(['cle']);
            expect(desired.valueOf).toEqual(['eastlake']);

        });

        it('summarises changes as pairs, in the words the failure message uses', () => {

            const desired = { ohiocity: ['cle'], tremont: [], plant: ['cle'], willowick: ['eastlake'] };

            const { addedPairs, removedPairs } = PicklistDependencyMetadataWriterService
                .buildChangedPairSummaries(currentSettings, desired);

            expect(addedPairs).toEqual(['cle unlocks plant']);
            expect(removedPairs).toEqual(['cle no longer unlocks tremont']);

        });

    });

    /*
        Decode and encode have to be inverses. Skipping a form on the way in while escaping it on the
        way out is not conservative, it silently rewrites the value: the encoder cannot tell one of
        its own escapes from data, so anything the decoder leaves as literal "&..." comes back
        double-escaped and changes what Salesforce stores.
    */
    describe('xml entity round trip', () => {

        const roundTrip = (sourceText: string) => PicklistDependencyMetadataWriterService
            .encodeXmlText(PicklistDependencyMetadataWriterService.decodeXmlText(sourceText));

        it('round trips the five named entities without changing them', () => {

            expect(roundTrip('Tom &amp; Jerry')).toBe('Tom &amp; Jerry');
            expect(roundTrip('a &lt; b')).toBe('a &lt; b');
            expect(roundTrip('a &gt; b')).toBe('a &gt; b');

        });

        it('round trips a decimal character reference without double escaping it', () => {

            expect(PicklistDependencyMetadataWriterService.decodeXmlText('Bob&#39;s')).toBe(`Bob's`);
            expect(roundTrip('Bob&#39;s')).not.toContain('&amp;');

        });

        it('round trips a hexadecimal character reference', () => {

            expect(PicklistDependencyMetadataWriterService.decodeXmlText('Bob&#x27;s')).toBe(`Bob's`);
            expect(PicklistDependencyMetadataWriterService.decodeXmlText('caf&#xE9;')).toBe('caf\u00e9');

        });

        // AN ALREADY ESCAPED ENTITY IS TEXT, NOT AN ENTITY -- IT MUST NOT COLLAPSE A SECOND TIME
        it('does not double decode an escaped entity', () => {

            expect(PicklistDependencyMetadataWriterService.decodeXmlText('&amp;lt;')).toBe('&lt;');
            expect(roundTrip('&amp;lt;')).toBe('&amp;lt;');
            expect(roundTrip('&amp;amp;')).toBe('&amp;amp;');

        });

        it('leaves a reference outside the code point range exactly as written', () => {

            expect(PicklistDependencyMetadataWriterService.decodeXmlText('&#1114112;')).toBe('&#1114112;');

        });

        it('does not escape quotes, which need it only inside an attribute value', () => {

            expect(PicklistDependencyMetadataWriterService.encodeXmlText(`Bob's "Diner"`)).toBe(`Bob's "Diner"`);

        });

    });

    describe('commented out markup is not markup', () => {

        it('given a valueSettings block inside an xml comment, does not collect it', () => {

            const contentWithCommentedBlock = readMock('FlatShape.field-meta.xml').replace(
                '        <valueSettings>\n            <controllingFieldValue>cle</controllingFieldValue>\n            <valueName>ohiocity</valueName>\n        </valueSettings>',
                '        <!-- <valueSettings>\n            <controllingFieldValue>cle</controllingFieldValue>\n            <valueName>commented</valueName>\n        </valueSettings> -->'
            );

            const blocks = PicklistDependencyMetadataWriterService.collectValueSettingsBlocks(contentWithCommentedBlock);

            expect(blocks.map(block => block.valueName)).not.toContain('commented');

        });

        it('keeps reported indexes pointing at the original content', () => {

            const contentWithLeadingComment = readMock('FlatShape.field-meta.xml')
                .replace('        <valueSettings>', '        <!-- a note -->\n        <valueSettings>');

            const blocks = PicklistDependencyMetadataWriterService.collectValueSettingsBlocks(contentWithLeadingComment);

            blocks.forEach(block => {
                expect(contentWithLeadingComment.slice(block.startIndex, block.endIndex)).toStartWith('<valueSettings>');
            });

        });

    });

    describe('emitting valueSettings markup', () => {

        it('emits the grouped shape as one block per dependent value', () => {

            const markup = PicklistDependencyMetadataWriterService.buildValueSettingsMarkup(
                { tree: ['eastlake', 'cle'] }, 'grouped', '        '
            );

            expect(markup.match(/<valueSettings>/g)).toHaveLength(1);
            expect(markup.match(/<controllingFieldValue>/g)).toHaveLength(2);

        });

        it('emits the flat shape as one block per pair', () => {

            const markup = PicklistDependencyMetadataWriterService.buildValueSettingsMarkup(
                { tree: ['eastlake', 'cle'] }, 'flat', '        '
            );

            expect(markup.match(/<valueSettings>/g)).toHaveLength(2);

        });

        // WHAT MAKES A SECOND WRITEBACK A NO-OP, AND THEREFORE WHAT MAKES THESE FILES REVIEWABLE
        it('sorts dependent values and controlling values alphabetically', () => {

            const markup = PicklistDependencyMetadataWriterService.buildValueSettingsMarkup(
                { weed: ['madison'], tree: ['eastlake', 'cle'] }, 'grouped', '        '
            );

            expect(markup.indexOf('<valueName>tree<')).toBeLessThan(markup.indexOf('<valueName>weed<'));
            expect(markup.indexOf('cle')).toBeLessThan(markup.indexOf('eastlake'));

        });

        it('emits the file\'s own line ending rather than always LF', () => {

            const crlfMarkup = PicklistDependencyMetadataWriterService.buildValueSettingsMarkup(
                { tree: ['cle'] }, 'flat', '        ', '\r\n'
            );

            expect(crlfMarkup).toContain('\r\n');
            expect(crlfMarkup.replace(/\r\n/g, '')).not.toContain('\n');

        });

        it('detects the line ending from the file, treating a mixed file as LF', () => {

            const lfContent = readMock('FlatShape.field-meta.xml');
            const crlfContent = lfContent.replace(/\n/g, '\r\n');

            expect(PicklistDependencyMetadataWriterService.resolveValueSettingsRegion(lfContent).lineEnding).toBe('\n');
            expect(PicklistDependencyMetadataWriterService.resolveValueSettingsRegion(crlfContent).lineEnding).toBe('\r\n');

            // ONE LONE LF MAKES IT MIXED, AND MIXED MUST NOT EMIT CRLF
            const mixedContent = crlfContent.replace('\r\n', '\n');
            expect(PicklistDependencyMetadataWriterService.resolveValueSettingsRegion(mixedContent).lineEnding).toBe('\n');

        });

        it('drops a dependent value no controlling value unlocks, rather than emitting an empty block', () => {

            const markup = PicklistDependencyMetadataWriterService.buildValueSettingsMarkup(
                { tree: ['cle'], orphaned: [] }, 'grouped', '        '
            );

            expect(markup).not.toContain('orphaned');
            expect(markup.match(/<valueSettings>/g)).toHaveLength(1);

        });

        /*
            The values emitted here are admin-controlled metadata, and the markup this produces is
            deployed to an org. A value that could close its own element would inject a sibling into
            a field file.
        */
        it('given a value that tries to close its own element, escapes it rather than emitting markup', () => {

            const markup = PicklistDependencyMetadataWriterService.buildValueSettingsMarkup(
                { '</valueName><fullName>Hacked</fullName>': ['cle'] }, 'flat', '        '
            );

            expect(markup).not.toContain('<fullName>Hacked</fullName>');
            expect(markup).toContain('&lt;/valueName&gt;&lt;fullName&gt;Hacked&lt;/fullName&gt;');

            // AND IT STILL READS BACK AS THE ONE VALUE IT ACTUALLY IS
            const reReadBlocks = PicklistDependencyMetadataWriterService.collectValueSettingsBlocks(markup);
            expect(reReadBlocks).toHaveLength(1);
            expect(reReadBlocks[0].valueName).toBe('</valueName><fullName>Hacked</fullName>');

        });

        it('given a value containing the CDATA terminator, escapes it', () => {

            const markup = PicklistDependencyMetadataWriterService.buildValueSettingsMarkup(
                { 'ends]]> here': ['cle'] }, 'flat', '        '
            );

            expect(markup).toContain('ends]]&gt; here');

        });

        it('re-encodes xml entities so a value with an ampersand survives the round trip', () => {

            const markup = PicklistDependencyMetadataWriterService.buildValueSettingsMarkup(
                { [`Tom & Jerry's`]: ['cle'] }, 'flat', '        '
            );

            expect(markup).toContain(`<valueName>Tom &amp; Jerry's</valueName>`);

            const reReadBlocks = PicklistDependencyMetadataWriterService.collectValueSettingsBlocks(markup);
            expect(reReadBlocks[0].valueName).toBe(`Tom & Jerry's`);

        });

    });

});
