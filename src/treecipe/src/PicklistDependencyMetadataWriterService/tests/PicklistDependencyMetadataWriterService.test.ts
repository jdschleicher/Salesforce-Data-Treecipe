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

        it('summarises changes as pairs, in the words the failure message uses', () => {

            const desired = { ohiocity: ['cle'], tremont: [], plant: ['cle'], willowick: ['eastlake'] };

            const { addedPairs, removedPairs } = PicklistDependencyMetadataWriterService
                .buildChangedPairSummaries(currentSettings, desired);

            expect(addedPairs).toEqual(['cle unlocks plant']);
            expect(removedPairs).toEqual(['cle no longer unlocks tremont']);

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

        it('drops a dependent value no controlling value unlocks, rather than emitting an empty block', () => {

            const markup = PicklistDependencyMetadataWriterService.buildValueSettingsMarkup(
                { tree: ['cle'], orphaned: [] }, 'grouped', '        '
            );

            expect(markup).not.toContain('orphaned');
            expect(markup.match(/<valueSettings>/g)).toHaveLength(1);

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
