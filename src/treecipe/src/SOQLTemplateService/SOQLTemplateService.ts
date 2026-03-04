import { ObjectInfoWrapper } from '../ObjectInfoWrapper/ObjectInfoWrapper';
import { ObjectInfo } from '../ObjectInfoWrapper/ObjectInfo';
import { FieldInfo } from '../ObjectInfoWrapper/FieldInfo';
const LOOKUP_FIELD_TYPES = ['Lookup', 'MasterDetail', 'Hiearchy'];

const TEXT_FIELD_TYPES = ['Text', 'TextArea', 'LongTextArea', 'Html', 'Email', 'Phone', 'Url'];

export class SOQLTemplateService {

    static generateSOQLTemplateMarkdownForTree(objectInfoWrapper: ObjectInfoWrapper, treeObjectNames: string[], timestamp: string): string {

        const treeWrapper = new ObjectInfoWrapper();
        for (const objectName of treeObjectNames) {
            if (objectName in objectInfoWrapper.ObjectToObjectInfoMap) {
                treeWrapper.ObjectToObjectInfoMap[objectName] = objectInfoWrapper.ObjectToObjectInfoMap[objectName];
            }
        }

        return this.generateSOQLTemplateMarkdown(treeWrapper, timestamp);

    }

    static generateSOQLTemplateMarkdown(objectInfoWrapper: ObjectInfoWrapper, timestamp: string): string {

        const objectNames = Object.keys(objectInfoWrapper.ObjectToObjectInfoMap).sort();

        const sections: string[] = [
            `# SOQL & SOSL Query Templates`,
            ``,
            `Generated: ${timestamp}`,
            `Objects: ${objectNames.join(', ')}`,
            ``,
            `---`,
        ];

        for (const objectName of objectNames) {
            const objectInfo = objectInfoWrapper.ObjectToObjectInfoMap[objectName];
            sections.push(this.buildObjectSection(objectName, objectInfo, objectInfoWrapper));
            sections.push(`---`);
        }

        return sections.join('\n');

    }

    static buildObjectSection(objectName: string, objectInfo: ObjectInfo, objectInfoWrapper: ObjectInfoWrapper): string {

        const sections: string[] = [
            ``,
            `## ${objectName}`,
            ``,
            `### Base Query`,
            ``,
            `\`\`\`sql`,
            this.buildSelectAllQuery(objectName, objectInfo),
            `\`\`\``,
            ``,
        ];

        const childToParentQueries = this.buildChildToParentQueries(objectName, objectInfo, objectInfoWrapper);
        if (childToParentQueries.length > 0) {
            sections.push(`### Child-to-Parent Queries`);
            sections.push(``);
            for (const query of childToParentQueries) {
                sections.push(`\`\`\`sql`);
                sections.push(query);
                sections.push(`\`\`\``);
                sections.push(``);
            }
        }

        const parentToChildQueries = this.buildParentToChildSubqueries(objectName, objectInfo, objectInfoWrapper);
        if (parentToChildQueries.length > 0) {
            sections.push(`### Parent-to-Child Queries`);
            sections.push(``);
            for (const query of parentToChildQueries) {
                sections.push(`\`\`\`sql`);
                sections.push(query);
                sections.push(`\`\`\``);
                sections.push(``);
            }
        }

        const recordTypeQueries = this.buildRecordTypeFilteredQueries(objectName, objectInfo);
        if (recordTypeQueries.length > 0) {
            sections.push(`### Record Type Filtered Queries`);
            sections.push(``);
            for (const query of recordTypeQueries) {
                sections.push(`\`\`\`sql`);
                sections.push(query);
                sections.push(`\`\`\``);
                sections.push(``);
            }
        }

        sections.push(`### SOSL Template`);
        sections.push(``);
        sections.push(`\`\`\`sosl`);
        sections.push(this.buildSOSLTemplate(objectName, objectInfo));
        sections.push(`\`\`\``);
        sections.push(``);

        return sections.join('\n');

    }

    static buildSelectAllQuery(objectName: string, objectInfo: ObjectInfo): string {

        const fieldNames = (objectInfo.Fields ?? []).map(f => f.fieldName);
        const allFields = ['Id', ...fieldNames];
        return `SELECT ${allFields.join(',\n       ')}\nFROM ${objectName}`;

    }

    static buildChildToParentQueries(objectName: string, objectInfo: ObjectInfo, objectInfoWrapper: ObjectInfoWrapper): string[] {

        const lookupFields = (objectInfo.Fields ?? []).filter(f => LOOKUP_FIELD_TYPES.includes(f.type));
        const queries: string[] = [];

        for (const field of lookupFields) {

            const parentName = field.referenceTo;
            if (!parentName) { continue; }

            const relationshipName = this.getRelationshipNameFromField(field);
            const parentInfo = objectInfoWrapper.ObjectToObjectInfoMap[parentName];

            let parentFieldTraversals: string[] = [];
            if (parentInfo?.Fields) {
                parentFieldTraversals = parentInfo.Fields
                    .filter(f => !LOOKUP_FIELD_TYPES.includes(f.type))
                    .slice(0, 5)
                    .map(f => `${relationshipName}.${f.fieldName}`);
            }

            const selectFields = ['Id', field.fieldName, ...parentFieldTraversals];
            queries.push(
                `-- ${field.type} to ${parentName} via ${field.fieldName}\n` +
                `SELECT ${selectFields.join(',\n       ')}\n` +
                `FROM ${objectName}`
            );

        }

        return queries;

    }

    static buildParentToChildSubqueries(objectName: string, objectInfo: ObjectInfo, objectInfoWrapper: ObjectInfoWrapper): string[] {

        if (!objectInfo.RelationshipDetail?.childObjectToFieldReferences) { return []; }

        const queries: string[] = [];
        const childRefs = objectInfo.RelationshipDetail.childObjectToFieldReferences;

        for (const [childObjectName, lookupFieldNames] of Object.entries(childRefs)) {

            if (!(childObjectName in objectInfoWrapper.ObjectToObjectInfoMap)) { continue; }

            const childInfo = objectInfoWrapper.ObjectToObjectInfoMap[childObjectName];
            const childFields = (childInfo?.Fields ?? [])
                .filter(f => !LOOKUP_FIELD_TYPES.includes(f.type))
                .slice(0, 5)
                .map(f => f.fieldName);

            const childSelectFields = ['Id', ...childFields].join(', ');
            const childRelationshipName = this.deriveChildRelationshipName(childObjectName);
            const lookupFieldNote = lookupFieldNames.join(', ');

            queries.push(
                `-- Children: ${childObjectName} (via ${lookupFieldNote})\n` +
                `-- Note: Verify '${childRelationshipName}' is the correct Child Relationship Name\n` +
                `SELECT Id,\n` +
                `    (SELECT ${childSelectFields}\n` +
                `     FROM ${childRelationshipName})\n` +
                `FROM ${objectName}`
            );

        }

        return queries;

    }

    static buildRecordTypeFilteredQueries(objectName: string, objectInfo: ObjectInfo): string[] {

        if (!objectInfo.RecordTypesMap || Object.keys(objectInfo.RecordTypesMap).length === 0) { return []; }

        const fieldNames = (objectInfo.Fields ?? [])
            .filter(f => !LOOKUP_FIELD_TYPES.includes(f.type))
            .map(f => f.fieldName);

        const selectFields = ['Id', ...fieldNames].join(',\n       ');

        return Object.keys(objectInfo.RecordTypesMap).map(developerName =>
            `-- Record Type: ${developerName}\n` +
            `SELECT ${selectFields}\n` +
            `FROM ${objectName}\n` +
            `WHERE RecordType.DeveloperName = '${developerName}'`
        );

    }

    static buildSOSLTemplate(objectName: string, objectInfo: ObjectInfo): string {

        const textFields = (objectInfo.Fields ?? [])
            .filter(f => TEXT_FIELD_TYPES.includes(f.type))
            .map(f => f.fieldName);

        const returningFields = ['Id', ...textFields].join(', ');
        return `FIND {searchTerm} IN ALL FIELDS\nRETURNING ${objectName}(${returningFields})`;

    }

    static getRelationshipNameFromField(fieldInfo: FieldInfo): string {

        const fieldName = fieldInfo.fieldName;

        if (fieldName.endsWith('Id') && !fieldName.includes('__')) {
            return fieldName.slice(0, -2);
        }

        if (fieldName.endsWith('__c')) {
            return fieldName.replace('__c', '__r');
        }

        return fieldName;

    }

    static deriveChildRelationshipName(childObjectName: string): string {

        if (childObjectName.endsWith('__c')) {
            const baseName = childObjectName.replace('__c', '');
            return `${baseName}s__r`;
        }

        return `${childObjectName}s`;

    }

}
