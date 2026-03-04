import { ObjectInfoWrapper } from '../ObjectInfoWrapper/ObjectInfoWrapper';
import { ObjectInfo } from '../ObjectInfoWrapper/ObjectInfo';
import { FieldInfo } from '../ObjectInfoWrapper/FieldInfo';

const LOOKUP_FIELD_TYPES = ['Lookup', 'MasterDetail', 'Hiearchy'];

export class MermaidService {

    static generateMermaidMarkdownForTree(objectInfoWrapper: ObjectInfoWrapper, treeObjectNames: string[], timestamp: string): string {

        const treeWrapper = new ObjectInfoWrapper();
        for (const objectName of treeObjectNames) {
            if (objectName in objectInfoWrapper.ObjectToObjectInfoMap) {
                treeWrapper.ObjectToObjectInfoMap[objectName] = objectInfoWrapper.ObjectToObjectInfoMap[objectName];
            }
        }

        return this.generateMermaidMarkdown(treeWrapper, timestamp);

    }

    static generateMermaidMarkdown(objectInfoWrapper: ObjectInfoWrapper, timestamp: string): string {

        const objectNames = Object.keys(objectInfoWrapper.ObjectToObjectInfoMap).sort();

        const sections: string[] = [
            `# Entity Relationship Diagram`,
            ``,
            `This diagram illustrates the object model for the Salesforce entities in this Treecipe tree.`,
            `Each entity block lists its typed fields (string, number, date, datetime, boolean).`,
            `Lookup relationships are shown with \`|o--o{\` cardinality (optional parent).`,
            `MasterDetail relationships are shown with \`||--o{\` cardinality (required parent).`,
            `Cross-tree relationships are excluded — only objects present in this recipe are shown.`,
            ``,
            `Generated: ${timestamp}`,
            `Objects: ${objectNames.join(', ')}`,
            ``,
            `---`,
            ``,
            `\`\`\`mermaid`,
            this.buildMermaidERD(objectInfoWrapper),
            `\`\`\``,
        ];

        return sections.join('\n');

    }

    static buildMermaidERD(objectInfoWrapper: ObjectInfoWrapper): string {

        const lines: string[] = ['erDiagram'];
        const objectNames = Object.keys(objectInfoWrapper.ObjectToObjectInfoMap).sort();

        for (const objectName of objectNames) {
            const objectInfo = objectInfoWrapper.ObjectToObjectInfoMap[objectName];
            const sanitizedName = this.sanitizeForMermaid(objectName);

            lines.push(`    ${sanitizedName} {`);
            lines.push(`        id Id`);

            const nonRelationshipFields = (objectInfo.Fields ?? []).filter(
                f => !LOOKUP_FIELD_TYPES.includes(f.type)
            );
            for (const field of nonRelationshipFields) {
                const mermaidType = this.getMermaidFieldType(field.type);
                lines.push(`        ${mermaidType} ${field.fieldName}`);
            }

            lines.push(`    }`);
        }

        lines.push(``);

        for (const objectName of objectNames) {
            const objectInfo = objectInfoWrapper.ObjectToObjectInfoMap[objectName];
            for (const field of (objectInfo.Fields ?? [])) {

                if (!LOOKUP_FIELD_TYPES.includes(field.type)) { continue; }

                const parentName = field.referenceTo;
                if (!parentName || !(parentName in objectInfoWrapper.ObjectToObjectInfoMap)) { continue; }

                const parentSanitized = this.sanitizeForMermaid(parentName);
                const childSanitized = this.sanitizeForMermaid(objectName);
                const cardinality = field.type === 'MasterDetail' ? `||--o{` : `|o--o{`;
                lines.push(`    ${parentSanitized} ${cardinality} ${childSanitized} : "${field.fieldName}"`);

            }
        }

        return lines.join('\n');

    }

    static sanitizeForMermaid(objectName: string): string {
        return objectName.replace(/-/g, '_');
    }

    static getMermaidFieldType(salesforceFieldType: string): string {

        const typeMap: Record<string, string> = {
            'Text': 'string',
            'TextArea': 'string',
            'LongTextArea': 'string',
            'Html': 'string',
            'Email': 'string',
            'Phone': 'string',
            'Url': 'string',
            'Number': 'number',
            'Currency': 'number',
            'Percent': 'number',
            'Date': 'date',
            'DateTime': 'datetime',
            'Boolean': 'boolean',
            'Checkbox': 'boolean',
            'Picklist': 'string',
            'MultiselectPicklist': 'string',
            'MultiSelectPicklist': 'string',
            'AutoNumber': 'string',
            'Formula': 'string',
            'EncryptedText': 'string',
        };

        return typeMap[salesforceFieldType] ?? 'string';

    }

}
