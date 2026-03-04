import { SOQLTemplateService } from '../SOQLTemplateService';
import { ObjectInfoWrapper } from '../../ObjectInfoWrapper/ObjectInfoWrapper';
import { ObjectInfo } from '../../ObjectInfoWrapper/ObjectInfo';
import { FieldInfo } from '../../ObjectInfoWrapper/FieldInfo';
import { RelationshipDetail } from '../../RelationshipService/RelationshipService';

import * as matchers from 'jest-extended';
expect.extend(matchers);


function buildMockWrapper(objects: Record<string, {
    fields: Array<{ name: string; label: string; type: string; referenceTo?: string }>;
    childRefs?: Record<string, string[]>;
    recordTypes?: Record<string, { DeveloperName: string; PicklistFieldSectionsToPicklistDetail: Record<string, string[]> }>;
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

        if (config.recordTypes) {
            objectInfo.RecordTypesMap = config.recordTypes as any;
        }
    }

    return wrapper;

}


describe('SOQLTemplateService', () => {

    describe('buildSelectAllQuery', () => {

        it('includes Id plus all field names', () => {
            const wrapper = buildMockWrapper({
                Account: { fields: [
                    { name: 'Name', label: 'Name', type: 'Text' },
                    { name: 'Phone', label: 'Phone', type: 'Phone' },
                ]}
            });
            const result = SOQLTemplateService.buildSelectAllQuery('Account', wrapper.ObjectToObjectInfoMap['Account']);
            expect(result).toContain('SELECT');
            expect(result).toContain('Id');
            expect(result).toContain('Name');
            expect(result).toContain('Phone');
            expect(result).toContain('FROM Account');
        });

        it('handles object with no fields — only includes Id', () => {
            const wrapper = buildMockWrapper({ Account: { fields: [] } });
            const result = SOQLTemplateService.buildSelectAllQuery('Account', wrapper.ObjectToObjectInfoMap['Account']);
            expect(result).toContain('Id');
            expect(result).toContain('FROM Account');
        });

    });


    describe('getRelationshipNameFromField', () => {

        it('derives relationship name from a standard Salesforce lookup field ending in Id', () => {
            const field = FieldInfo.create('Contact', 'AccountId', 'Account', 'Lookup', [], null, 'Account', null);
            expect(SOQLTemplateService.getRelationshipNameFromField(field)).toBe('Account');
        });

        it('derives relationship name from a custom lookup field ending in __c', () => {
            const field = FieldInfo.create('Child__c', 'Parent_Object__c', 'Parent', 'Lookup', [], null, 'Parent_Object__c', null);
            expect(SOQLTemplateService.getRelationshipNameFromField(field)).toBe('Parent_Object__r');
        });

        it('returns the fieldName unchanged for unrecognized patterns', () => {
            const field = FieldInfo.create('Obj__c', 'SomeField', 'Some Field', 'Lookup', [], null, null, null);
            expect(SOQLTemplateService.getRelationshipNameFromField(field)).toBe('SomeField');
        });

    });


    describe('deriveChildRelationshipName', () => {

        it('pluralizes standard object names', () => {
            expect(SOQLTemplateService.deriveChildRelationshipName('Contact')).toBe('Contacts');
        });

        it('adds __r suffix and pluralizes custom objects', () => {
            expect(SOQLTemplateService.deriveChildRelationshipName('Custom_Object__c')).toBe('Custom_Objects__r');
        });

    });


    describe('buildChildToParentQueries', () => {

        it('generates one query per lookup field', () => {
            const wrapper = buildMockWrapper({
                Contact: { fields: [
                    { name: 'FirstName', label: 'First Name', type: 'Text' },
                    { name: 'AccountId', label: 'Account', type: 'Lookup', referenceTo: 'Account' },
                ]},
                Account: { fields: [
                    { name: 'Name', label: 'Name', type: 'Text' },
                    { name: 'Industry', label: 'Industry', type: 'Picklist' },
                ]},
            });

            const result = SOQLTemplateService.buildChildToParentQueries('Contact', wrapper.ObjectToObjectInfoMap['Contact'], wrapper);
            expect(result).toHaveLength(1);
            expect(result[0]).toContain('AccountId');
            expect(result[0]).toContain('Account.Name');
            expect(result[0]).toContain('FROM Contact');
        });

        it('returns empty array when object has no lookup fields', () => {
            const wrapper = buildMockWrapper({
                Account: { fields: [{ name: 'Name', label: 'Name', type: 'Text' }] }
            });
            const result = SOQLTemplateService.buildChildToParentQueries('Account', wrapper.ObjectToObjectInfoMap['Account'], wrapper);
            expect(result).toHaveLength(0);
        });

        it('omits parent field traversals when parent object is not in the wrapper', () => {
            const wrapper = buildMockWrapper({
                Contact: { fields: [
                    { name: 'AccountId', label: 'Account', type: 'Lookup', referenceTo: 'Account' },
                ]},
            });
            const result = SOQLTemplateService.buildChildToParentQueries('Contact', wrapper.ObjectToObjectInfoMap['Contact'], wrapper);
            expect(result).toHaveLength(1);
            expect(result[0]).toContain('AccountId');
            expect(result[0]).not.toContain('Account.Name');
        });

        it('skips lookup fields with no referenceTo', () => {
            const wrapper = buildMockWrapper({
                Contact: { fields: [
                    { name: 'SomeLookup__c', label: 'Some Lookup', type: 'Lookup' },
                ]},
            });
            const result = SOQLTemplateService.buildChildToParentQueries('Contact', wrapper.ObjectToObjectInfoMap['Contact'], wrapper);
            expect(result).toHaveLength(0);
        });

    });


    describe('buildParentToChildSubqueries', () => {

        it('generates a subquery for each child object reference', () => {
            const wrapper = buildMockWrapper({
                Account: {
                    fields: [{ name: 'Name', label: 'Name', type: 'Text' }],
                    childRefs: { Contact: ['AccountId'] },
                },
                Contact: { fields: [
                    { name: 'FirstName', label: 'First Name', type: 'Text' },
                    { name: 'Email', label: 'Email', type: 'Email' },
                ]},
            });

            const result = SOQLTemplateService.buildParentToChildSubqueries('Account', wrapper.ObjectToObjectInfoMap['Account'], wrapper);
            expect(result).toHaveLength(1);
            expect(result[0]).toContain('FROM Account');
            expect(result[0]).toContain('AccountId');
            expect(result[0]).toContain('FirstName');
            expect(result[0]).toContain('Email');
        });

        it('returns empty array when object has no child references', () => {
            const wrapper = buildMockWrapper({
                Account: { fields: [{ name: 'Name', label: 'Name', type: 'Text' }] }
            });
            const result = SOQLTemplateService.buildParentToChildSubqueries('Account', wrapper.ObjectToObjectInfoMap['Account'], wrapper);
            expect(result).toHaveLength(0);
        });

        it('returns empty array when RelationshipDetail is undefined', () => {
            const wrapper = buildMockWrapper({
                Account: { fields: [{ name: 'Name', label: 'Name', type: 'Text' }] }
            });
            wrapper.ObjectToObjectInfoMap['Account'].RelationshipDetail = undefined;
            const result = SOQLTemplateService.buildParentToChildSubqueries('Account', wrapper.ObjectToObjectInfoMap['Account'], wrapper);
            expect(result).toHaveLength(0);
        });

        it('skips child objects that are not present in the wrapper', () => {
            const wrapper = buildMockWrapper({
                Account: {
                    fields: [{ name: 'Name', label: 'Name', type: 'Text' }],
                    childRefs: { UnknownObject__c: ['Account__c'] },
                },
            });
            const result = SOQLTemplateService.buildParentToChildSubqueries('Account', wrapper.ObjectToObjectInfoMap['Account'], wrapper);
            expect(result).toHaveLength(0);
        });

    });


    describe('buildRecordTypeFilteredQueries', () => {

        it('generates one query per record type', () => {
            const wrapper = buildMockWrapper({
                Account: {
                    fields: [{ name: 'Name', label: 'Name', type: 'Text' }],
                    recordTypes: {
                        Customer: { DeveloperName: 'Customer', PicklistFieldSectionsToPicklistDetail: {} },
                        Partner: { DeveloperName: 'Partner', PicklistFieldSectionsToPicklistDetail: {} },
                    },
                },
            });
            const result = SOQLTemplateService.buildRecordTypeFilteredQueries('Account', wrapper.ObjectToObjectInfoMap['Account']);
            expect(result).toHaveLength(2);
            expect(result.some(q => q.includes("'Customer'"))).toBeTrue();
            expect(result.some(q => q.includes("'Partner'"))).toBeTrue();
            expect(result.every(q => q.includes('WHERE RecordType.DeveloperName'))).toBeTrue();
        });

        it('returns empty array when no record types exist', () => {
            const wrapper = buildMockWrapper({
                Account: { fields: [{ name: 'Name', label: 'Name', type: 'Text' }] }
            });
            const result = SOQLTemplateService.buildRecordTypeFilteredQueries('Account', wrapper.ObjectToObjectInfoMap['Account']);
            expect(result).toHaveLength(0);
        });

        it('excludes lookup fields from the select list', () => {
            const wrapper = buildMockWrapper({
                Account: {
                    fields: [
                        { name: 'Name', label: 'Name', type: 'Text' },
                        { name: 'AccountId', label: 'Account', type: 'Lookup', referenceTo: 'Account' },
                    ],
                    recordTypes: {
                        Customer: { DeveloperName: 'Customer', PicklistFieldSectionsToPicklistDetail: {} },
                    },
                },
            });
            const result = SOQLTemplateService.buildRecordTypeFilteredQueries('Account', wrapper.ObjectToObjectInfoMap['Account']);
            expect(result[0]).not.toContain('AccountId');
        });

    });


    describe('buildSOSLTemplate', () => {

        it('includes only text-type fields in the RETURNING clause', () => {
            const wrapper = buildMockWrapper({
                Account: { fields: [
                    { name: 'Name', label: 'Name', type: 'Text' },
                    { name: 'Phone', label: 'Phone', type: 'Phone' },
                    { name: 'Amount__c', label: 'Amount', type: 'Currency' },
                    { name: 'AccountId', label: 'Account', type: 'Lookup', referenceTo: 'Account' },
                ]},
            });
            const result = SOQLTemplateService.buildSOSLTemplate('Account', wrapper.ObjectToObjectInfoMap['Account']);
            expect(result).toContain('FIND {searchTerm} IN ALL FIELDS');
            expect(result).toContain('RETURNING Account(');
            expect(result).toContain('Name');
            expect(result).toContain('Phone');
            expect(result).not.toContain('Amount__c');
            expect(result).not.toContain('AccountId');
        });

        it('returns template with only Id when no text fields exist', () => {
            const wrapper = buildMockWrapper({
                Account: { fields: [
                    { name: 'Amount__c', label: 'Amount', type: 'Currency' },
                ]},
            });
            const result = SOQLTemplateService.buildSOSLTemplate('Account', wrapper.ObjectToObjectInfoMap['Account']);
            expect(result).toContain('RETURNING Account(Id)');
        });

    });


    describe('generateSOQLTemplateMarkdown', () => {

        it('includes SOQL/SOSL section headers but not Mermaid ERD', () => {
            const wrapper = buildMockWrapper({
                Account: { fields: [{ name: 'Name', label: 'Name', type: 'Text' }] }
            });
            const result = SOQLTemplateService.generateSOQLTemplateMarkdown(wrapper, '2024-01-01T00-00-00');
            expect(result).toContain('# SOQL & SOSL Query Templates');
            expect(result).toContain('## Account');
            expect(result).toContain('### Base Query');
            expect(result).toContain('### SOSL Template');
            expect(result).not.toContain('## Entity Relationship Diagram');
            expect(result).not.toContain('```mermaid');
            expect(result).not.toContain('erDiagram');
        });

        it('includes the timestamp in the output', () => {
            const wrapper = buildMockWrapper({
                Account: { fields: [] }
            });
            const timestamp = '2024-06-15T12-30-00';
            const result = SOQLTemplateService.generateSOQLTemplateMarkdown(wrapper, timestamp);
            expect(result).toContain(timestamp);
        });

        it('includes a section for each object in the wrapper', () => {
            const wrapper = buildMockWrapper({
                Account: { fields: [{ name: 'Name', label: 'Name', type: 'Text' }] },
                Contact: { fields: [{ name: 'FirstName', label: 'First Name', type: 'Text' }] },
            });
            const result = SOQLTemplateService.generateSOQLTemplateMarkdown(wrapper, '2024-01-01T00-00-00');
            expect(result).toContain('## Account');
            expect(result).toContain('## Contact');
        });

        it('includes relationship sections when lookups exist', () => {
            const wrapper = buildMockWrapper({
                Account: {
                    fields: [{ name: 'Name', label: 'Name', type: 'Text' }],
                    childRefs: { Contact: ['AccountId'] },
                },
                Contact: { fields: [
                    { name: 'AccountId', label: 'Account', type: 'Lookup', referenceTo: 'Account' },
                ]},
            });
            const result = SOQLTemplateService.generateSOQLTemplateMarkdown(wrapper, '2024-01-01T00-00-00');
            expect(result).toContain('### Child-to-Parent Queries');
            expect(result).toContain('### Parent-to-Child Queries');
        });

    });


    describe('generateSOQLTemplateMarkdownForTree', () => {

        it('only includes sections for objects in the specified tree', () => {
            const wrapper = buildMockWrapper({
                Account: { fields: [{ name: 'Name', label: 'Name', type: 'Text' }] },
                Contact: { fields: [{ name: 'FirstName', label: 'First Name', type: 'Text' }] },
                Opportunity: { fields: [{ name: 'StageName', label: 'Stage', type: 'Text' }] },
            });
            const result = SOQLTemplateService.generateSOQLTemplateMarkdownForTree(
                wrapper, ['Account', 'Contact'], '2024-01-01T00-00-00'
            );
            expect(result).toContain('## Account');
            expect(result).toContain('## Contact');
            expect(result).not.toContain('## Opportunity');
        });

        it('does not include ERD content in the SOQL template', () => {
            const wrapper = buildMockWrapper({
                Account: { fields: [{ name: 'Name', label: 'Name', type: 'Text' }] },
                Contact: { fields: [{ name: 'FirstName', label: 'First Name', type: 'Text' }] },
            });
            const result = SOQLTemplateService.generateSOQLTemplateMarkdownForTree(
                wrapper, ['Account', 'Contact'], '2024-01-01T00-00-00'
            );
            expect(result).not.toContain('erDiagram');
            expect(result).not.toContain('```mermaid');
        });

        it('excludes parent-to-child subqueries for children outside the tree', () => {
            const wrapper = buildMockWrapper({
                Account: {
                    fields: [{ name: 'Name', label: 'Name', type: 'Text' }],
                    childRefs: { Contact: ['AccountId'], Opportunity: ['AccountId'] },
                },
                Contact: { fields: [{ name: 'FirstName', label: 'First Name', type: 'Text' }] },
                Opportunity: { fields: [{ name: 'StageName', label: 'Stage', type: 'Text' }] },
            });
            const result = SOQLTemplateService.generateSOQLTemplateMarkdownForTree(
                wrapper, ['Account', 'Contact'], '2024-01-01T00-00-00'
            );
            expect(result).toContain('Contact');
            expect(result).not.toContain('Opportunity');
        });

        it('gracefully handles object names not found in the full wrapper', () => {
            const wrapper = buildMockWrapper({
                Account: { fields: [{ name: 'Name', label: 'Name', type: 'Text' }] },
            });
            const result = SOQLTemplateService.generateSOQLTemplateMarkdownForTree(
                wrapper, ['Account', 'NonExistentObject__c'], '2024-01-01T00-00-00'
            );
            expect(result).toContain('## Account');
            expect(result).not.toContain('## NonExistentObject__c');
        });

    });


});
