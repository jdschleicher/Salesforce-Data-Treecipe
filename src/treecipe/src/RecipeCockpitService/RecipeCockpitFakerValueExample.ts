import { ReadOnlyFields } from '../ObjectInfoWrapper/ReadOnlyFields';
import { StandardDerivedFields } from '../ObjectInfoWrapper/StandardDerivedFields';

/*
    Which field rows get "Test faker value" (#718): the panel draws the button only where every rule
    holds, and the host checks the same rules again before it runs anything. Host-free -- it imports
    only files that import nothing -- so the panel bundles it.
*/

export interface IFakerValueExampleField {
    objectApiName: string;
    fieldApiName: string;
    recipeValue: string;
    controllingField?: string;
}

interface IFakerValueExampleRule {
    ruleName: string;
    isMet: (field: IFakerValueExampleField) => boolean;
    reason: string;
}

// THE LONGEST EXAMPLE THE HOST POSTS; A LONGER ONE IS CUT AND ENDS IN "…"
export const RECIPE_COCKPIT_FAKER_VALUE_EXAMPLE_MAX_LENGTH = 500;

export class RecipeCockpitFakerValueExample {

    static readonly rules: readonly IFakerValueExampleRule[] = [
        {
            ruleName: 'hasExpression',
            isMet: field => RecipeCockpitFakerValueExample.hasExpressionLine(field.recipeValue),
            reason: 'has no "${{ ... }}" faker expression to run'
        },
        {
            ruleName: 'isNotReadOnly',
            isMet: field => ReadOnlyFields.readReason(field.recipeValue) === undefined,
            reason: 'is set by Salesforce, not generated'
        },
        {
            ruleName: 'isNotDerived',
            isMet: field => StandardDerivedFields.resolveDerivedField(field.objectApiName, field.fieldApiName) === undefined,
            reason: 'is set by Salesforce from another lookup'
        },
        {
            ruleName: 'isNotDependentPicklist',
            isMet: field => !field.controllingField,
            reason: 'takes its value from its controlling field, so one field alone cannot be run'
        }
    ];

    static findNoExampleReason(field: IFakerValueExampleField): string | undefined {
        return this.rules.find(rule => !rule.isMet(field))?.reason;
    }

    /*
        The same test as RecipeCockpitRecipeWriter.findFirstExpressionLine, which the host runs to
        take the expression out: a line that is, or double-quotes, one "${{ ... }}" with no line
        break either YAML reader sees. The writer is too large to bundle into the panel, so a test
        holds the two to the same answer on every value the golden recipes write.
    */
    static hasExpressionLine(recipeValue: string): boolean {

        return String(recipeValue ?? '').split('\n').some(valueLine => {
            const trimmedLine = valueLine.trim();
            let candidate: unknown = trimmedLine;
            if ( trimmedLine.length >= 2 && trimmedLine.startsWith('"') && trimmedLine.endsWith('"') ) {
                try {
                    candidate = JSON.parse(trimmedLine);
                } catch {
                    candidate = trimmedLine;
                }
            }
            return typeof candidate === 'string' && candidate.startsWith('${{') && !/[\r\n\u0085\u2028\u2029]/.test(candidate);
        });

    }

    // A GENERATED VALUE AS ONE LINE OF TEXT: A STRING AS IT IS, ANYTHING ELSE AS JSON, CUT TO THE LIMIT
    static toExampleText(generatedValue: unknown): string {

        const exampleText = typeof generatedValue === 'string' ? generatedValue : JSON.stringify(generatedValue) ?? String(generatedValue);

        return exampleText.length > RECIPE_COCKPIT_FAKER_VALUE_EXAMPLE_MAX_LENGTH
            ? exampleText.slice(0, RECIPE_COCKPIT_FAKER_VALUE_EXAMPLE_MAX_LENGTH) + '…'
            : exampleText;

    }

}
