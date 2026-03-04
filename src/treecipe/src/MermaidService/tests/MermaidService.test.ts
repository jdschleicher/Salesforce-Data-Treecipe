import { MermaidService } from '../MermaidService';
import { ObjectInfoWrapper } from '../../ObjectInfoWrapper/ObjectInfoWrapper';
import { FieldInfo } from '../../ObjectInfoWrapper/FieldInfo';
import { RelationshipDetail } from '../../RelationshipService/RelationshipService';

import * as matchers from 'jest-extended';
expect.extend(matchers);


function buildMockWrapper(objects: Record<string, {
    fields: Array<{ name: string; label: string; type: string; referenceTo?: string }>;
    childRefs?: Record<string, string[]>;
}>): ObjectInfoWrapper {

    const wrapper = new ObjectInfoWrapper();

    for (const [objectName, config] of Object.entries(objects)) {
        wrapper.addKeyToObjectInfoMap(objectName);
        const objectInfo = wrapper.ObjectToObjectInfoMap[objectName];

        objectInfo.Fields = config.fields.map(f =>
            FieldInfo.create(objectName, f.name, f.label, f.type, [], null, f.referenceTo ?? null, null)
        );

        const relDetail: RelationshipDetail = {
            objectApiName: objectName,
            level: 0,
            childObjectToFieldReferences: config.childRefs ?? {},
            parentObjectToFieldReferences: {},
            isProcessed: true,
        };
        objectInfo.RelationshipDetail = relDetail;
    }

    return wrapper;

}


describe('MermaidService', () => {

    describe('buildMermaidERD', () => {

        it('starts with erDiagram header', () => {
            const wrapper = buildMockWrapper({
                Account: { fields: [{ name: 'Name', label: 'Name', type: 'Text' }] }
            });
            const result = MermaidService.buildMermaidERD(wrapper);
            expect(result).toStartWith('erDiagram');
        });

        it('uses ||--o{ cardinality for MasterDetail relationships', () => {
            const wrapper = buildMockWrapper({
                Account: { fields: [{ name: 'Name', label: 'Name', type: 'Text' }] },
                Contact: { fields: [
                    { name: 'AccountId', label: 'Account', type: 'MasterDetail', referenceTo: 'Account' }
                ]},
            });
            const result = MermaidService.buildMermaidERD(wrapper);
            expect(result).toContain('||--o{');
        });

        it('uses |o--o{ cardinality for Lookup relationships', () => {
            const wrapper = buildMockWrapper({
                Account: { fields: [{ name: 'Name', label: 'Name', type: 'Text' }] },
                Contact: { fields: [
                    { name: 'AccountId', label: 'Account', type: 'Lookup', referenceTo: 'Account' }
                ]},
            });
            const result = MermaidService.buildMermaidERD(wrapper);
            expect(result).toContain('|o--o{');
        });

        it('excludes lookup fields from entity attribute blocks', () => {
            const wrapper = buildMockWrapper({
                Contact: { fields: [
                    { name: 'FirstName', label: 'First Name', type: 'Text' },
                    { name: 'AccountId', label: 'Account', type: 'Lookup', referenceTo: 'Account' },
                ]},
                Account: { fields: [] },
            });
            const result = MermaidService.buildMermaidERD(wrapper);
            const contactEntityBlock = result.substring(
                result.indexOf('Contact {'),
                result.indexOf('}', result.indexOf('Contact {')) + 1
            );
            expect(contactEntityBlock).toContain('FirstName');
            expect(contactEntityBlock).not.toContain('AccountId');
        });

        it('omits relationship line when referenced object is not in the wrapper', () => {
            const wrapper = buildMockWrapper({
                Contact: { fields: [
                    { name: 'AccountId', label: 'Account', type: 'Lookup', referenceTo: 'Account' },
                ]},
            });
            const result = MermaidService.buildMermaidERD(wrapper);
            expect(result).not.toContain('||--o{');
            expect(result).not.toContain('|o--o{');
        });

    });


    describe('getMermaidFieldType', () => {

        it('maps Text to string', () => {
            expect(MermaidService.getMermaidFieldType('Text')).toBe('string');
        });

        it('maps Number and Currency to number', () => {
            expect(MermaidService.getMermaidFieldType('Number')).toBe('number');
            expect(MermaidService.getMermaidFieldType('Currency')).toBe('number');
        });

        it('maps Date and DateTime correctly', () => {
            expect(MermaidService.getMermaidFieldType('Date')).toBe('date');
            expect(MermaidService.getMermaidFieldType('DateTime')).toBe('datetime');
        });

        it('maps Boolean and Checkbox to boolean', () => {
            expect(MermaidService.getMermaidFieldType('Boolean')).toBe('boolean');
            expect(MermaidService.getMermaidFieldType('Checkbox')).toBe('boolean');
        });

        it('defaults to string for unknown types', () => {
            expect(MermaidService.getMermaidFieldType('UnknownCustomType')).toBe('string');
        });

    });


    describe('generateMermaidMarkdown', () => {

        it('includes the ERD title and description', () => {
            const wrapper = buildMockWrapper({
                Account: { fields: [{ name: 'Name', label: 'Name', type: 'Text' }] }
            });
            const result = MermaidService.generateMermaidMarkdown(wrapper, '2024-01-01T00-00-00');
            expect(result).toContain('# Entity Relationship Diagram');
            expect(result).toContain('Lookup relationships');
            expect(result).toContain('MasterDetail relationships');
        });

        it('includes the mermaid code block with erDiagram', () => {
            const wrapper = buildMockWrapper({
                Account: { fields: [{ name: 'Name', label: 'Name', type: 'Text' }] }
            });
            const result = MermaidService.generateMermaidMarkdown(wrapper, '2024-01-01T00-00-00');
            expect(result).toContain('```mermaid');
            expect(result).toContain('erDiagram');
        });

        it('includes the timestamp and object list', () => {
            const wrapper = buildMockWrapper({
                Account: { fields: [{ name: 'Name', label: 'Name', type: 'Text' }] },
                Contact: { fields: [{ name: 'FirstName', label: 'First Name', type: 'Text' }] },
            });
            const timestamp = '2024-06-15T12-30-00';
            const result = MermaidService.generateMermaidMarkdown(wrapper, timestamp);
            expect(result).toContain(timestamp);
            expect(result).toContain('Account');
            expect(result).toContain('Contact');
        });

        it('does not include SOQL query sections', () => {
            const wrapper = buildMockWrapper({
                Account: { fields: [{ name: 'Name', label: 'Name', type: 'Text' }] }
            });
            const result = MermaidService.generateMermaidMarkdown(wrapper, '2024-01-01T00-00-00');
            expect(result).not.toContain('### Base Query');
            expect(result).not.toContain('SOSL Template');
            expect(result).not.toContain('SELECT');
        });

    });


    describe('generateMermaidMarkdownForTree', () => {

        it('only includes ERD entities for objects in the specified tree', () => {
            const wrapper = buildMockWrapper({
                Account: { fields: [{ name: 'Name', label: 'Name', type: 'Text' }] },
                Contact: { fields: [{ name: 'FirstName', label: 'First Name', type: 'Text' }] },
                Opportunity: { fields: [{ name: 'StageName', label: 'Stage', type: 'Text' }] },
            });
            const result = MermaidService.generateMermaidMarkdownForTree(
                wrapper, ['Account', 'Contact'], '2024-01-01T00-00-00'
            );
            const mermaidBlock = result.substring(result.indexOf('erDiagram'));
            expect(mermaidBlock).toContain('Account');
            expect(mermaidBlock).toContain('Contact');
            expect(mermaidBlock).not.toContain('Opportunity');
        });

        it('includes the title and description in the output', () => {
            const wrapper = buildMockWrapper({
                Account: { fields: [{ name: 'Name', label: 'Name', type: 'Text' }] },
            });
            const result = MermaidService.generateMermaidMarkdownForTree(
                wrapper, ['Account'], '2024-01-01T00-00-00'
            );
            expect(result).toContain('# Entity Relationship Diagram');
        });

        it('gracefully handles object names not found in the full wrapper', () => {
            const wrapper = buildMockWrapper({
                Account: { fields: [{ name: 'Name', label: 'Name', type: 'Text' }] },
            });
            const result = MermaidService.generateMermaidMarkdownForTree(
                wrapper, ['Account', 'NonExistentObject__c'], '2024-01-01T00-00-00'
            );
            expect(result).toContain('Account');
            expect(result).not.toContain('NonExistentObject__c');
        });

    });

});
