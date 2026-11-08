import * as path from 'path';
import * as xml2js from 'xml2js';

import { SalesforceApiName } from '../SalesforceApiName/SalesforceApiName';
import { IValidationRuleAnalysis, IValidationRuleFieldConstraint, ValidationRuleAnalyzerService } from '../ValidationRuleAnalyzerService/ValidationRuleAnalyzerService';
import { XMLFieldDetail } from '../XMLProcessingService/XMLFieldDetail';
import { IMetadataDeployComponent, METADATA_DEPLOY_SUMMARY_YIELD_EVERY_FILES, RecipeCockpitMetadataDeploy } from './RecipeCockpitMetadataDeploy';
import { IOrgMetadataFileCopy, IOrgStagedFieldDetail, RecipeCockpitOrgChangeDetection } from './RecipeCockpitOrgChangeDetection';
import { RecipeCockpitRecipeWriter } from '../RecipeWriter/RecipeCockpitRecipeWriter';

/*
    "Get latest object detail from target org" (#612): ONE object of a Treecipe tab row, retrieved
    from the org the reader chose into a staging folder, compared kind by kind with the project, and
    -- for the items the reader ticks -- copied into the project and patched into the recipe line by
    line, every other line byte-identical. The org's files and the repository's are untrusted: each
    is read without following a link, held to a size, parsed with no prototype trust, and every name
    held to SalesforceApiName. Imports no vscode.
*/

export type ObjectRefreshKind = 'fields' | 'validationRules' | 'recordTypes' | 'globalValueSets';

export const OBJECT_REFRESH_KINDS: readonly ObjectRefreshKind[] = Object.freeze(['fields', 'validationRules', 'recordTypes', 'globalValueSets'] as ObjectRefreshKind[]);

// THE SAME LABELS AS THE TROUBLESHOOTING TAB'S RETRIEVES, SO A KIND READS THE SAME IN BOTH PLACES
export const OBJECT_REFRESH_KIND_LABELS: Readonly<Record<ObjectRefreshKind, string>> = Object.freeze({
    fields: 'Fields',
    validationRules: 'Validation rules',
    recordTypes: 'Record types',
    globalValueSets: 'Global value sets'
});

export const OBJECT_REFRESH_OPERATION_NAME = 'object-refresh';

// A VALIDATION RULE'S VALUE IS THE FIELD'S OWN, CONSTRAINED, SO IT IS WRITTEN LAST
const OBJECT_REFRESH_RECIPE_APPLY_ORDER: readonly ObjectRefreshKind[] = Object.freeze(['fields', 'globalValueSets', 'validationRules', 'recordTypes'] as ObjectRefreshKind[]);

export type ObjectRefreshItemStatus = 'new' | 'changed';

// WHAT A TICKED ITEM DOES TO THE RECIPE, SAID ON ITS ROW BEFORE IT IS TICKED
export const OBJECT_REFRESH_RECIPE_NOTES = Object.freeze({
    addsLine: 'Adds one line to the recipe.',
    rewritesLine: 'Rewrites its recipe line.',
    pinned: 'Pinned to a fixed value: its recipe line is not changed.',
    notInRecipe: 'Not in the recipe: only the project file changes.',
    noExpression: 'No value is generated for this type: only the project file changes.',
    formula: 'A formula field: only the project file changes.',
    lookup: 'A lookup: only the project file changes. Wire it from its row.',
    dependentPicklist: 'A dependent picklist: only the project file changes. Run Generate Treecipe to write its if: block.',
    recordTypeSections: 'The recipe has a section per record type for this object: only the project file changes. Use Regenerate with record types.',
    recordType: 'Only the project file changes. Use Regenerate with record types to add its section.',
    rulesOff: 'This field\'s validation rules are switched off on its row: its recipe line is not changed.',
    ruleInactive: 'Inactive: only the project file changes.',
    noBackend: 'The card\'s faker backend is not known: only the project file changes.',
    noFieldUsesValueSet: 'No field of this object in the recipe uses it: only the project file changes.'
});

// ONE LINE A TICKED ITEM WRITES INTO THE RECIPE; HOST-ONLY
export interface IObjectRefreshRecipeChange {
    operation: 'insert' | 'replace';
    fieldApiName: string;
    valueText: string;
}

// ONE ROW OF STEP 3, AS POSTED: NAMES AND TEXT ONLY, NEVER A PATH
export interface IObjectRefreshItem {
    kind: ObjectRefreshKind;
    name: string;
    status: ObjectRefreshItemStatus;
    detail: string;
    differences: string[];
    recipeNote: string;
}

// THE SAME ROW WITH WHAT APPLYING IT WRITES; HOST-ONLY, NEVER POSTED
export interface IObjectRefreshPlannedItem extends IObjectRefreshItem {
    fileCopy: IOrgMetadataFileCopy;
    recipeChanges: IObjectRefreshRecipeChange[];
    offersRecordTypeRegenerate?: boolean;
}

export interface IObjectRefreshComparison {
    isRetrieved: boolean;
    items: IObjectRefreshPlannedItem[];
    unchangedCountByKind: Record<ObjectRefreshKind, number>;
    unreadableCountByKind: Record<ObjectRefreshKind, number>;
}

/*
    What writes a field's value: the host's RecipeService for the recipe's own backend, so this
    module never loads a faker service (RecipeService reaches vscode) and both backends write as
    Generate Treecipe does.
*/
export interface IObjectRefreshExpressionSource {
    getRecipeFakeValueByXMLFieldDetail(xmlFieldDetail: XMLFieldDetail, recordTypeApiToRecordTypeWrapperMap: Record<string, never>): unknown;
    applyValidationRules(xmlFieldDetail: XMLFieldDetail, unconstrainedRecipeValue: string, fieldRuleConstraints: IValidationRuleFieldConstraint[], recordTypeApiToRecordTypeWrapperMap: Record<string, never>): { recipeValue: string };
}

// WHAT THE RECIPE SAYS AND WHAT THE CARD KEEPS BESIDE IT, READ BY THE HOST BEFORE THE COMPARISON
export interface IObjectRefreshRecipeContext {
    recipeText: string | undefined;
    // UNDEFINED WHEN THE CARD'S BACKEND IS NOT KNOWN: EVERY ITEM THEN CHANGES THE PROJECT FILE ONLY
    expressionSource: IObjectRefreshExpressionSource | undefined;
    objectNickname?: string;
    pinnedFieldApiNames: ReadonlySet<string>;
    validationRulesOffFieldApiNames: ReadonlySet<string>;
}

export interface IObjectRefreshComparisonRequest {
    workspaceRoot: string;
    packageDirectoryPaths: readonly string[];
    defaultPackageDirectoryPath: string;
    stagingFolderPath: string;
    objectApiName: string;
    kinds: readonly ObjectRefreshKind[];
    valueSetNames: readonly string[];
    recipeContext: IObjectRefreshRecipeContext;
}

export interface IObjectRefreshRecipeOutcome {
    recipeText: string;
    writtenLineCount: number;
    refusals: string[];
}

// ONE METADATA KIND THAT LIVES AS ONE FILE PER COMPONENT IN A SUBFOLDER OF THE OBJECT
interface IObjectChildFileKind {
    kind: Extract<ObjectRefreshKind, 'validationRules' | 'recordTypes'>;
    subfolderName: string;
    fileSuffix: string;
    rootElementName: string;
}

const OBJECT_CHILD_FILE_KINDS: Readonly<Record<IObjectChildFileKind['kind'], IObjectChildFileKind>> = Object.freeze({
    validationRules: { kind: 'validationRules', subfolderName: 'validationRules', fileSuffix: '.validationRule-meta.xml', rootElementName: 'ValidationRule' },
    recordTypes: { kind: 'recordTypes', subfolderName: 'recordTypes', fileSuffix: '.recordType-meta.xml', rootElementName: 'RecordType' }
});

const GLOBAL_VALUE_SET_FOLDER_NAME = 'globalValueSets';
const GLOBAL_VALUE_SET_FILE_SUFFIX = '.globalValueSet-meta.xml';

// WHAT A VALIDATION RULE'S CHANGE IS JUDGED BY: WHAT DECIDES WHETHER, AND HOW, IT SHAPES A VALUE
const VALIDATION_RULE_COMPARED_ELEMENTS = ['active', 'errorConditionFormula', 'errorDisplayField', 'errorMessage'] as const;

// HOW MANY VALUES ONE DIFFERENCE NAMES BEFORE IT COUNTS THE REST
const DIFFERENCE_VALUES_SHOWN = 5;

// ONE COMPONENT FILE ON EITHER SIDE, BY LOWER-CASED NAME; THE FIRST FOLDER HOLDING A NAME WINS, AS A DEPLOY READS THEM
interface IComponentFile {
    componentName: string;
    filePath: string;
}

export class RecipeCockpitObjectRefresh {

    static isKind(candidate: unknown): candidate is ObjectRefreshKind {
        return typeof candidate === 'string' && ( OBJECT_REFRESH_KINDS as readonly string[] ).includes(candidate);
    }

    /*
        What one retrieve names: the object, which brings its fields, validation rules and record
        types in source format, and the global value sets its picklists use when that kind is
        ticked. A standard object is asked for too, as the Adapter asks for one.
    */
    static buildRetrieveComponents(objectApiName: string, kinds: readonly ObjectRefreshKind[], valueSetNames: readonly string[]): IMetadataDeployComponent[] {

        if ( !SalesforceApiName.isApiName(objectApiName) ) {
            throw new Error(`"${RecipeCockpitOrgChangeDetection.toSingleLine(String(objectApiName))}" is not an object api name, so nothing was retrieved.`);
        }

        const isObjectAsked = kinds.some(kind => kind !== 'globalValueSets');
        const askedValueSetNames = kinds.includes('globalValueSets')
            ? [...new Set(valueSetNames.filter(valueSetName => SalesforceApiName.isApiName(valueSetName)))].sort()
            : [];

        return [
            // THE GLOBAL VALUE SETS ARE THE OBJECT'S: WITHOUT IT THE FIELDS THAT USE THEM ARE NOT KNOWN
            ...( isObjectAsked || askedValueSetNames.length > 0 ? [{ type: 'CustomObject' as const, member: objectApiName }] : [] ),
            ...askedValueSetNames.map(valueSetName => ({ type: 'GlobalValueSet' as const, member: valueSetName }))
        ];

    }

    static buildPackageXml(components: readonly IMetadataDeployComponent[], apiVersion?: string): string {

        if ( components.length === 0 ) {
            throw new Error('No component was named, so nothing was retrieved.');
        }

        const version = RecipeCockpitMetadataDeploy.readApiVersion(apiVersion);
        const typeNames = [...new Set(components.map(component => component.type))].sort();

        return [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
            ...typeNames.flatMap(typeName => [
                '    <types>',
                ...components.filter(component => component.type === typeName).map(component => component.member).sort()
                    .map(member => `        <members>${RecipeCockpitMetadataDeploy.escapeXmlText(member)}</members>`),
                `        <name>${typeName}</name>`,
                '    </types>'
            ]),
            ...( version ? [`    <version>${version}</version>`] : [] ),
            '</Package>',
            ''
        ].join('\n');

    }

    // THE GLOBAL VALUE SETS THE OBJECT'S PROJECT FIELD FILES NAME, BEFORE ANYTHING IS RETRIEVED
    static async listObjectValueSetNames(workspaceRoot: string, packageDirectoryPaths: readonly string[], objectApiName: string): Promise<string[]> {

        const localFields = await this.readFieldDetails(workspaceRoot, packageDirectoryPaths, objectApiName);

        return [...new Set([...localFields.values()].map(field => field.valueSetName).filter(valueSetName => SalesforceApiName.isApiName(valueSetName)))].sort();

    }

    /*
        Every new or changed item of the ticked kinds, each with the file it copies and the recipe
        lines it writes. Items only the project holds are not listed: nothing is ever deleted.
    */
    static async compareStagedObject(request: IObjectRefreshComparisonRequest): Promise<IObjectRefreshComparison> {

        const { workspaceRoot, packageDirectoryPaths, stagingFolderPath, objectApiName, kinds } = request;
        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
        const stagingRelativePath = path.relative(resolvedWorkspaceRoot, stagingFolderPath);
        const stagedObjectFolderPaths = RecipeCockpitMetadataDeploy.findObjectFolderPaths(resolvedWorkspaceRoot, [stagingRelativePath], [objectApiName]).get(objectApiName) ?? [];
        const localObjectFolderPaths = RecipeCockpitMetadataDeploy.findObjectFolderPaths(resolvedWorkspaceRoot, packageDirectoryPaths, [objectApiName]).get(objectApiName) ?? [];
        const stagedFields = await this.readFieldDetails(workspaceRoot, [stagingRelativePath], objectApiName);
        const stagedValueSetValues = kinds.includes('globalValueSets') ? await this.readValueSetValuesUnder(resolvedWorkspaceRoot, [stagingRelativePath]) : new Map<string, string[]>();
        // A PICKLIST ON A GLOBAL VALUE SET IS WRITTEN FROM THE ORG'S VALUES WHEN THEY WERE RETRIEVED, ELSE FROM THE PROJECT'S
        const valueSetValuesForExpressions = new Map([...await this.readValueSetValuesUnder(resolvedWorkspaceRoot, packageDirectoryPaths, request.valueSetNames), ...stagedValueSetValues]);
        const recipeScan = this.scanRecipeObject(request.recipeContext, objectApiName);
        const stagedRuleAnalyses = await this.analyzeStagedRules(stagedObjectFolderPaths);

        const comparison: IObjectRefreshComparison = {
            isRetrieved: stagedObjectFolderPaths.length > 0 || stagedValueSetValues.size > 0,
            items: [],
            unchangedCountByKind: { fields: 0, validationRules: 0, recordTypes: 0, globalValueSets: 0 },
            unreadableCountByKind: { fields: 0, validationRules: 0, recordTypes: 0, globalValueSets: 0 }
        };

        const fieldRecipeContext: IFieldRecipeContext = { request: request, recipeScan: recipeScan, expressionSource: request.recipeContext.expressionSource, stagedRuleAnalyses: stagedRuleAnalyses, stagedFields: stagedFields, stagedValueSetValues: stagedValueSetValues, valueSetValuesForExpressions: valueSetValuesForExpressions };

        for ( const kind of OBJECT_REFRESH_KINDS.filter(candidateKind => kinds.includes(candidateKind)) ) {
            if ( kind === 'fields' ) {
                await this.compareFields(request, fieldRecipeContext, comparison);
            } else if ( kind === 'globalValueSets' ) {
                await this.compareGlobalValueSets(request, fieldRecipeContext, comparison);
            } else {
                await this.compareObjectChildFiles(OBJECT_CHILD_FILE_KINDS[kind], stagedObjectFolderPaths, localObjectFolderPaths, request, fieldRecipeContext, comparison);
            }
        }

        return comparison;

    }

    /*
        The recipe with every ticked item's lines written through the line patcher alone, so every
        other line stays byte-identical. Kinds are applied fields, then global value sets, then
        validation rules, so a rule's constrained value is never overwritten by a plain one; a line
        is inserted only when the text does not hold it yet. A line the patcher refuses is named and
        the rest are still written.
    */
    static applyRecipeChanges(recipeText: string, objectApiName: string, objectNickname: string | undefined, items: readonly IObjectRefreshPlannedItem[]): IObjectRefreshRecipeOutcome {

        let patchedRecipeText = recipeText;
        let writtenLineCount = 0;
        const refusals: string[] = [];
        const orderedItems = [...items].sort((first, second) => OBJECT_REFRESH_RECIPE_APPLY_ORDER.indexOf(first.kind) - OBJECT_REFRESH_RECIPE_APPLY_ORDER.indexOf(second.kind));

        orderedItems.forEach(item => item.recipeChanges.forEach(recipeChange => {

            const isLineHeld = this.scanRecipeObject({ recipeText: patchedRecipeText, objectNickname: objectNickname }, objectApiName).fieldApiNames.has(recipeChange.fieldApiName);
            const writerResult = isLineHeld
                ? RecipeCockpitRecipeWriter.replaceFieldValue(patchedRecipeText, objectApiName, recipeChange.fieldApiName, recipeChange.valueText, objectNickname)
                : RecipeCockpitRecipeWriter.insertField(patchedRecipeText, objectApiName, recipeChange.fieldApiName, recipeChange.valueText, objectNickname);

            if ( 'refusal' in writerResult ) {
                refusals.push(`${objectApiName}.${recipeChange.fieldApiName}: ${writerResult.refusal.message}`);
            } else {
                patchedRecipeText = writerResult.recipeText;
                writtenLineCount++;
            }

        }));

        return { recipeText: patchedRecipeText, writtenLineCount: writtenLineCount, refusals: refusals };

    }

    private static async compareFields(request: IObjectRefreshComparisonRequest, fieldRecipeContext: IFieldRecipeContext, comparison: IObjectRefreshComparison) {

        const { workspaceRoot, packageDirectoryPaths, defaultPackageDirectoryPath, stagingFolderPath, objectApiName } = request;
        const [objectChanges] = await RecipeCockpitOrgChangeDetection.detectFieldChanges(workspaceRoot, packageDirectoryPaths, stagingFolderPath, [objectApiName]);
        const fieldFileCopies = await RecipeCockpitOrgChangeDetection.planFieldFileCopies(workspaceRoot, packageDirectoryPaths, defaultPackageDirectoryPath, stagingFolderPath, [objectApiName]);
        const targetFilePathByFieldName = new Map(fieldFileCopies.map(fieldFileCopy => [fieldFileCopy.fieldApiName, fieldFileCopy] as const));

        comparison.unchangedCountByKind.fields = objectChanges?.unchangedFieldCount ?? 0;
        comparison.unreadableCountByKind.fields = objectChanges?.unreadableFieldCount ?? 0;

        ( objectChanges?.fieldChanges ?? [] ).forEach(fieldChange => {

            const fieldFileCopy = targetFilePathByFieldName.get(fieldChange.fieldApiName);
            if ( !fieldFileCopy ) {
                return;
            }

            const recipeDecision = this.decideFieldRecipe(fieldChange.fieldApiName, fieldRecipeContext);

            comparison.items.push({
                kind: 'fields',
                name: fieldChange.fieldApiName,
                status: fieldChange.status,
                detail: fieldChange.fieldType,
                differences: fieldChange.differences,
                recipeNote: recipeDecision.recipeNote,
                fileCopy: { componentLabel: `${objectApiName}.${fieldChange.fieldApiName}`, stagedFilePath: fieldFileCopy.stagedFilePath, targetFilePath: fieldFileCopy.targetFilePath },
                recipeChanges: recipeDecision.recipeChanges
            });

        });

    }

    /*
        A field's recipe line, by the first rule that holds, each with why; the value is what the
        recipe's OWN backend writes after "Field: " for the staged file, as Generate Treecipe writes
        it (a "|" block or a quoted scalar where the backend needs one), with the field's active rules
        in the org applied as Generate Treecipe applies a project's (#324) unless they are switched
        off on its row (#325), so a rewritten line never drops a constraint.
    */
    private static decideFieldRecipe(fieldApiName: string, fieldRecipeContext: IFieldRecipeContext): IFieldRecipeDecision {

        const fieldRecipeRules: readonly IFieldRecipeRule[] = [
            { name: 'record type sections', holds: ruleInput => ruleInput.recipeScan.hasRecordTypeSections, recipeNote: OBJECT_REFRESH_RECIPE_NOTES.recordTypeSections },
            { name: 'pinned', holds: ruleInput => ruleInput.request.recipeContext.pinnedFieldApiNames.has(ruleInput.fieldApiName), recipeNote: OBJECT_REFRESH_RECIPE_NOTES.pinned },
            { name: 'object not in recipe', holds: ruleInput => !ruleInput.recipeScan.isObjectInRecipe, recipeNote: OBJECT_REFRESH_RECIPE_NOTES.notInRecipe },
            { name: 'no backend', holds: ruleInput => ruleInput.expressionSource === undefined, recipeNote: OBJECT_REFRESH_RECIPE_NOTES.noBackend },
            { name: 'formula', holds: ruleInput => ruleInput.stagedField?.isFormula === true, recipeNote: OBJECT_REFRESH_RECIPE_NOTES.formula },
            { name: 'lookup', holds: ruleInput => ( ruleInput.stagedField?.referenceTo ?? '' ) !== '', recipeNote: OBJECT_REFRESH_RECIPE_NOTES.lookup },
            { name: 'dependent picklist', holds: ruleInput => ( ruleInput.stagedField?.controllingField ?? '' ) !== '', recipeNote: OBJECT_REFRESH_RECIPE_NOTES.dependentPicklist }
        ];

        const stagedField = fieldRecipeContext.stagedFields.get(fieldApiName.toLowerCase());
        const ruleInput: IFieldRecipeRuleInput = { ...fieldRecipeContext, fieldApiName: fieldApiName, stagedField: stagedField };
        const heldRule = fieldRecipeRules.find(fieldRecipeRule => fieldRecipeRule.holds(ruleInput));

        if ( heldRule ) {
            return { recipeNote: heldRule.recipeNote, recipeChanges: [] };
        }

        const recipeValue = stagedField ? this.buildFieldRecipeValue(stagedField, fieldRecipeContext) : undefined;
        if ( recipeValue === undefined ) {
            return { recipeNote: OBJECT_REFRESH_RECIPE_NOTES.noExpression, recipeChanges: [] };
        }

        const fieldConstraints = fieldRecipeContext.request.recipeContext.validationRulesOffFieldApiNames.has(fieldApiName)
            ? []
            : fieldRecipeContext.stagedRuleAnalyses.constraintsByLowerFieldName.get(fieldApiName.toLowerCase()) ?? [];
        const constrainedValue = fieldConstraints.length > 0 && stagedField && fieldRecipeContext.expressionSource
            ? fieldRecipeContext.expressionSource.applyValidationRules(this.toXmlFieldDetail(stagedField, fieldRecipeContext), recipeValue, fieldConstraints, {}).recipeValue
            : recipeValue;

        const isInRecipe = fieldRecipeContext.recipeScan.fieldApiNames.has(fieldApiName);
        return {
            recipeNote: isInRecipe ? OBJECT_REFRESH_RECIPE_NOTES.rewritesLine : OBJECT_REFRESH_RECIPE_NOTES.addsLine,
            recipeChanges: [{ operation: isInRecipe ? 'replace' : 'insert', fieldApiName: fieldApiName, valueText: constrainedValue }]
        };

    }

    private static async compareObjectChildFiles(childFileKind: IObjectChildFileKind,
                                                 stagedObjectFolderPaths: readonly string[],
                                                 localObjectFolderPaths: readonly string[],
                                                 request: IObjectRefreshComparisonRequest,
                                                 fieldRecipeContext: IFieldRecipeContext,
                                                 comparison: IObjectRefreshComparison) {

        const { objectApiName } = request;
        const stagedFiles = this.listComponentFiles(stagedObjectFolderPaths.map(folderPath => path.join(folderPath, childFileKind.subfolderName)), childFileKind.fileSuffix);
        const localFiles = this.listComponentFiles(localObjectFolderPaths.map(folderPath => path.join(folderPath, childFileKind.subfolderName)), childFileKind.fileSuffix);
        const newFolderPath = path.join(this.findDefaultObjectFolderPath(request), childFileKind.subfolderName);
        let readFileCount = 0;

        for ( const [lowerComponentName, stagedFile] of stagedFiles ) {

            readFileCount++;
            if ( readFileCount % METADATA_DEPLOY_SUMMARY_YIELD_EVERY_FILES === 0 ) {
                await new Promise(resolve => setImmediate(resolve));
            }

            const stagedXml = RecipeCockpitOrgChangeDetection.readMetadataFileText(stagedFile.filePath);
            const stagedRoot = stagedXml === undefined ? undefined : await this.parseRoot(stagedXml, childFileKind.rootElementName);
            if ( !stagedRoot ) {
                comparison.unreadableCountByKind[childFileKind.kind]++;
                continue;
            }

            const localFile = localFiles.get(lowerComponentName);
            let differences: string[] = [];
            if ( localFile ) {
                const localXml = RecipeCockpitOrgChangeDetection.readMetadataFileText(localFile.filePath);
                const localRoot = localXml === undefined ? undefined : await this.parseRoot(localXml, childFileKind.rootElementName);
                if ( !localRoot ) {
                    comparison.unreadableCountByKind[childFileKind.kind]++;
                    continue;
                }
                differences = childFileKind.kind === 'validationRules' ? this.compareValidationRules(localRoot, stagedRoot) : this.compareRecordTypes(localRoot, stagedRoot);
                if ( differences.length === 0 ) {
                    comparison.unchangedCountByKind[childFileKind.kind]++;
                    continue;
                }
            }

            const componentName = localFile?.componentName ?? stagedFile.componentName;
            const recipeDecision = childFileKind.kind === 'validationRules'
                ? this.decideValidationRuleRecipe(stagedFile, stagedRoot, fieldRecipeContext)
                : { recipeNote: OBJECT_REFRESH_RECIPE_NOTES.recordType, recipeChanges: [] };

            comparison.items.push({
                kind: childFileKind.kind,
                name: componentName,
                status: localFile ? 'changed' : 'new',
                detail: childFileKind.kind === 'validationRules'
                    ? ( this.readText(stagedRoot.active) === 'true' ? 'Active' : 'Inactive' )
                    : RecipeCockpitOrgChangeDetection.cutForDisplay(this.readText(stagedRoot.label) || componentName),
                differences: differences,
                recipeNote: recipeDecision.recipeNote,
                fileCopy: {
                    componentLabel: `${objectApiName}.${componentName}`,
                    stagedFilePath: stagedFile.filePath,
                    targetFilePath: localFile?.filePath ?? path.join(newFolderPath, `${componentName}${childFileKind.fileSuffix}`)
                },
                recipeChanges: recipeDecision.recipeChanges,
                ...( childFileKind.kind === 'recordTypes' ? { offersRecordTypeRegenerate: true } : {} )
            });

        }

    }

    /*
        A validation rule's recipe line: its field's own line, which carries every active rule the org
        holds on it (decideFieldRecipe). It only REWRITES a line the recipe has: a field the recipe
        lacks is added by ticking the field itself, whose file the Apply copies first, so the recipe
        never names a field the project lacks. Refused as a field line is (pinned, sections, ...), and
        when the rule is inactive, not a single-field shape, or switched off on the field's row (#325).
    */
    private static decideValidationRuleRecipe(stagedFile: IComponentFile,
                                              stagedRoot: Record<string, unknown>,
                                              fieldRecipeContext: IFieldRecipeContext): IFieldRecipeDecision {

        if ( this.readText(stagedRoot.active) !== 'true' ) {
            return { recipeNote: OBJECT_REFRESH_RECIPE_NOTES.ruleInactive, recipeChanges: [] };
        }

        const analysis = fieldRecipeContext.stagedRuleAnalyses.analysesByLowerRuleName.get(stagedFile.componentName.toLowerCase());
        const constraint = analysis?.constraint;
        if ( !constraint ) {
            return { recipeNote: `Not a rule a recipe can apply${analysis?.notAppliedReason ? `: ${RecipeCockpitOrgChangeDetection.cutForDisplay(RecipeCockpitOrgChangeDetection.toSingleLine(analysis.notAppliedReason))}` : ''}. Only the project file changes.`, recipeChanges: [] };
        }

        const fieldApiName = [...fieldRecipeContext.stagedFields.values()].find(field => field.fieldApiName.toLowerCase() === constraint.fieldReference.toLowerCase())?.fieldApiName ?? constraint.fieldReference;

        if ( fieldRecipeContext.request.recipeContext.validationRulesOffFieldApiNames.has(fieldApiName) ) {
            return { recipeNote: OBJECT_REFRESH_RECIPE_NOTES.rulesOff, recipeChanges: [] };
        }

        if ( !fieldRecipeContext.recipeScan.fieldApiNames.has(fieldApiName) ) {
            return { recipeNote: `${fieldApiName} is not in the recipe: only the project file changes. Tick ${fieldApiName} under Fields to add it with this rule applied.`, recipeChanges: [] };
        }

        const fieldDecision = this.decideFieldRecipe(fieldApiName, fieldRecipeContext);
        if ( fieldDecision.recipeChanges.length === 0 ) {
            return { recipeNote: `${fieldApiName}: ${fieldDecision.recipeNote}`, recipeChanges: [] };
        }

        return { recipeNote: `Rewrites the recipe line of ${fieldApiName}.`, recipeChanges: fieldDecision.recipeChanges };

    }

    /*
        Every staged validation rule file read and analysed ONCE per comparison, yielding as the
        other loops do: what the rule items and every field line read, so neither re-reads a rule.
        An inactive rule has no analysis (analyzeValidationRuleXml answers undefined) and constrains nothing.
    */
    private static async analyzeStagedRules(stagedObjectFolderPaths: readonly string[]): Promise<IStagedRuleAnalyses> {

        const ruleFiles = this.listComponentFiles(stagedObjectFolderPaths.map(folderPath => path.join(folderPath, OBJECT_CHILD_FILE_KINDS.validationRules.subfolderName)), OBJECT_CHILD_FILE_KINDS.validationRules.fileSuffix);
        const stagedRuleAnalyses: IStagedRuleAnalyses = { analysesByLowerRuleName: new Map(), constraintsByLowerFieldName: new Map() };
        let readFileCount = 0;

        for ( const [lowerRuleName, ruleFile] of ruleFiles ) {

            readFileCount++;
            if ( readFileCount % METADATA_DEPLOY_SUMMARY_YIELD_EVERY_FILES === 0 ) {
                await new Promise(resolve => setImmediate(resolve));
            }

            const ruleXml = RecipeCockpitOrgChangeDetection.readMetadataFileText(ruleFile.filePath);
            const analysis = ruleXml === undefined ? undefined : await ValidationRuleAnalyzerService.analyzeValidationRuleXml(ruleXml, path.basename(ruleFile.filePath));
            if ( !analysis ) {
                continue;
            }

            stagedRuleAnalyses.analysesByLowerRuleName.set(lowerRuleName, analysis);
            if ( analysis.constraint ) {
                const lowerFieldName = analysis.constraint.fieldReference.toLowerCase();
                stagedRuleAnalyses.constraintsByLowerFieldName.set(lowerFieldName, [...( stagedRuleAnalyses.constraintsByLowerFieldName.get(lowerFieldName) ?? [] ), analysis.constraint]);
            }

        }

        return stagedRuleAnalyses;

    }

    /*
        A global value set the object's picklists use: new or changed by its values, and, when
        ticked, each of the object's recipe picklist lines that uses it rewritten from the org's
        values through the recipe's backend and its escaper.
    */
    private static async compareGlobalValueSets(request: IObjectRefreshComparisonRequest, fieldRecipeContext: IFieldRecipeContext, comparison: IObjectRefreshComparison) {

        const { workspaceRoot, packageDirectoryPaths, defaultPackageDirectoryPath, valueSetNames } = request;
        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
        const stagingRelativePath = path.relative(resolvedWorkspaceRoot, request.stagingFolderPath);
        const stagedFiles = this.listComponentFiles(RecipeCockpitMetadataDeploy.findMetadataFolderPaths(resolvedWorkspaceRoot, [stagingRelativePath], GLOBAL_VALUE_SET_FOLDER_NAME), GLOBAL_VALUE_SET_FILE_SUFFIX);
        const localFiles = this.listComponentFiles(RecipeCockpitMetadataDeploy.findMetadataFolderPaths(resolvedWorkspaceRoot, packageDirectoryPaths, GLOBAL_VALUE_SET_FOLDER_NAME), GLOBAL_VALUE_SET_FILE_SUFFIX);
        const askedLowerNames = new Set(valueSetNames.map(valueSetName => valueSetName.toLowerCase()));
        const localFields = await this.readFieldDetails(workspaceRoot, packageDirectoryPaths, request.objectApiName);

        for ( const [lowerValueSetName, stagedFile] of stagedFiles ) {

            if ( !askedLowerNames.has(lowerValueSetName) ) {
                continue;
            }

            const stagedValues = fieldRecipeContext.stagedValueSetValues.get(lowerValueSetName);
            if ( !stagedValues ) {
                comparison.unreadableCountByKind.globalValueSets++;
                continue;
            }

            const localFile = localFiles.get(lowerValueSetName);
            let differences: string[] = [];
            if ( localFile ) {
                const localValues = await this.readValueSetValues(localFile.filePath);
                if ( !localValues ) {
                    comparison.unreadableCountByKind.globalValueSets++;
                    continue;
                }
                differences = this.compareValueLists('values', localValues, stagedValues);
                if ( differences.length === 0 ) {
                    comparison.unchangedCountByKind.globalValueSets++;
                    continue;
                }
            }

            const valueSetName = localFile?.componentName ?? stagedFile.componentName;
            const usingFieldApiNames = [...new Map([...localFields.values(), ...fieldRecipeContext.stagedFields.values()]
                .filter(field => field.valueSetName.toLowerCase() === lowerValueSetName && fieldRecipeContext.recipeScan.fieldApiNames.has(field.fieldApiName))
                .map(field => [field.fieldApiName, field] as const)).keys()].sort();
            const recipeChanges: IObjectRefreshRecipeChange[] = [];
            const skippedNotes: string[] = [];
            usingFieldApiNames.forEach(fieldApiName => {
                const fieldDecision = this.decideFieldRecipe(fieldApiName, fieldRecipeContext);
                if ( fieldDecision.recipeChanges.length > 0 ) {
                    recipeChanges.push(...fieldDecision.recipeChanges);
                } else {
                    skippedNotes.push(`${fieldApiName}: ${fieldDecision.recipeNote}`);
                }
            });

            comparison.items.push({
                kind: 'globalValueSets',
                name: valueSetName,
                status: localFile ? 'changed' : 'new',
                detail: `${stagedValues.length} ${stagedValues.length === 1 ? 'value' : 'values'}`,
                differences: differences,
                recipeNote: [
                    recipeChanges.length > 0
                        ? `Rewrites the recipe ${recipeChanges.length === 1 ? 'line' : 'lines'} of ${recipeChanges.map(recipeChange => recipeChange.fieldApiName).join(', ')}.`
                        : ( skippedNotes.length === 0 ? OBJECT_REFRESH_RECIPE_NOTES.noFieldUsesValueSet : '' ),
                    ...skippedNotes
                ].filter(noteText => noteText !== '').join(' '),
                fileCopy: {
                    componentLabel: valueSetName,
                    stagedFilePath: stagedFile.filePath,
                    targetFilePath: localFile?.filePath ?? path.join(path.resolve(resolvedWorkspaceRoot, defaultPackageDirectoryPath), 'main', 'default', GLOBAL_VALUE_SET_FOLDER_NAME, `${valueSetName}${GLOBAL_VALUE_SET_FILE_SUFFIX}`)
                },
                recipeChanges: recipeChanges
            });

        }

    }

    private static compareValidationRules(localRoot: Record<string, unknown>, stagedRoot: Record<string, unknown>): string[] {

        return VALIDATION_RULE_COMPARED_ELEMENTS
            .filter(elementName => this.readText(localRoot[elementName]) !== this.readText(stagedRoot[elementName]))
            .map(elementName => `${elementName}: ${this.showValue(this.readText(localRoot[elementName]))} → ${this.showValue(this.readText(stagedRoot[elementName]))}`);

    }

    // A RECORD TYPE IS JUDGED BY WHETHER IT IS ACTIVE, ITS LABEL, AND EACH PICKLIST'S VALUES FOR IT
    private static compareRecordTypes(localRoot: Record<string, unknown>, stagedRoot: Record<string, unknown>): string[] {

        const differences = (['active', 'label'] as const)
            .filter(elementName => this.readText(localRoot[elementName]) !== this.readText(stagedRoot[elementName]))
            .map(elementName => `${elementName}: ${this.showValue(this.readText(localRoot[elementName]))} → ${this.showValue(this.readText(stagedRoot[elementName]))}`);

        const localPicklists = this.readRecordTypePicklists(localRoot);
        const stagedPicklists = this.readRecordTypePicklists(stagedRoot);
        const picklistNames = [...new Set([...localPicklists.keys(), ...stagedPicklists.keys()])].sort();

        picklistNames.forEach(picklistName => {
            differences.push(...this.compareValueLists(picklistName, localPicklists.get(picklistName) ?? [], stagedPicklists.get(picklistName) ?? []));
        });

        return differences;

    }

    private static readRecordTypePicklists(recordTypeRoot: Record<string, unknown>): Map<string, string[]> {

        const picklists = new Map<string, string[]>();

        ( Array.isArray(recordTypeRoot.picklistValues) ? recordTypeRoot.picklistValues as unknown[] : [] ).forEach(picklistEntry => {
            const picklistRecord = this.asRecord(picklistEntry);
            const picklistName = this.readText(picklistRecord?.picklist);
            if ( !SalesforceApiName.isApiName(picklistName) ) {
                return;
            }
            const values = ( Array.isArray(picklistRecord?.values) ? picklistRecord.values as unknown[] : [] )
                .map(valueEntry => this.readText(this.asRecord(valueEntry)?.fullName))
                .filter(value => value !== '');
            picklists.set(picklistName, values);
        });

        return picklists;

    }

    // "<name>: +A, +B, −C"; THE ORDER OF VALUES IS NOT A CHANGE
    private static compareValueLists(listName: string, localValues: readonly string[], stagedValues: readonly string[]): string[] {

        const localSet = new Set(localValues);
        const stagedSet = new Set(stagedValues);
        const addedValues = stagedValues.filter(value => !localSet.has(value));
        const removedValues = localValues.filter(value => !stagedSet.has(value));

        if ( addedValues.length === 0 && removedValues.length === 0 ) {
            return [];
        }

        const shown = [...addedValues.map(value => `+${value}`), ...removedValues.map(value => `−${value}`)];
        const moreCount = shown.length - DIFFERENCE_VALUES_SHOWN;

        return [`${listName}: ${shown.slice(0, DIFFERENCE_VALUES_SHOWN).map(value => RecipeCockpitOrgChangeDetection.cutForDisplay(value)).join(', ')}${moreCount > 0 ? `, and ${moreCount} more` : ''}`];

    }

    // EVERY GLOBAL VALUE SET UNDER THE FOLDERS GIVEN THAT CAN BE READ -- ONLY THOSE NAMED, WHEN NAMES ARE GIVEN -- BY LOWER-CASED NAME
    private static async readValueSetValuesUnder(resolvedWorkspaceRoot: string, relativeFolderPaths: readonly string[], valueSetNames?: readonly string[]): Promise<Map<string, string[]>> {

        const valueSetValues = new Map<string, string[]>();
        const valueSetFiles = this.listComponentFiles(RecipeCockpitMetadataDeploy.findMetadataFolderPaths(resolvedWorkspaceRoot, relativeFolderPaths, GLOBAL_VALUE_SET_FOLDER_NAME), GLOBAL_VALUE_SET_FILE_SUFFIX);

        const askedLowerNames = valueSetNames ? new Set(valueSetNames.map(valueSetName => valueSetName.toLowerCase())) : undefined;

        for ( const [lowerValueSetName, valueSetFile] of valueSetFiles ) {
            if ( askedLowerNames && !askedLowerNames.has(lowerValueSetName) ) {
                continue;
            }
            const values = await this.readValueSetValues(valueSetFile.filePath);
            if ( values ) {
                valueSetValues.set(lowerValueSetName, values);
            }
        }

        return valueSetValues;

    }

    // A GLOBAL VALUE SET'S ACTIVE VALUES, IN ITS ORDER; UNDEFINED FOR A FILE THAT CANNOT BE READ OR IS NOT ONE
    private static async readValueSetValues(filePath: string): Promise<string[] | undefined> {

        const valueSetXml = RecipeCockpitOrgChangeDetection.readMetadataFileText(filePath);
        const valueSetRoot = valueSetXml === undefined ? undefined : await this.parseRoot(valueSetXml, 'GlobalValueSet');

        if ( !valueSetRoot ) {
            return undefined;
        }

        return ( Array.isArray(valueSetRoot.customValue) ? valueSetRoot.customValue as unknown[] : [] )
            .map(valueEntry => this.asRecord(valueEntry))
            .filter(valueRecord => this.readText(valueRecord?.isActive) !== 'false')
            .map(valueRecord => this.readText(valueRecord?.fullName))
            .filter(value => value !== '');

    }

    // UNDEFINED WHEN THE BACKEND WRITES NO VALUE: AN UNKNOWN TYPE, OR A TODO SUCH AS A PICKLIST WITH NO VALUES
    private static buildFieldRecipeValue(stagedField: IOrgStagedFieldDetail, fieldRecipeContext: IFieldRecipeContext): string | undefined {

        let recipeValue: unknown;
        try {
            recipeValue = fieldRecipeContext.expressionSource?.getRecipeFakeValueByXMLFieldDetail(this.toXmlFieldDetail(stagedField, fieldRecipeContext), {});
        } catch {
            return undefined;
        }

        // A TODO, QUOTED OR NOT, AS applyValidationRules READS ONE
        return typeof recipeValue === 'string' && recipeValue.includes('${{') && !/^"?\s*###/.test(recipeValue.trim()) ? recipeValue : undefined;

    }

    // A STAGED FIELD AS GENERATE TREECIPE READS ONE; A GLOBAL VALUE SET'S VALUES ARE THE ORG'S WHEN THEY WERE RETRIEVED
    private static toXmlFieldDetail(stagedField: IOrgStagedFieldDetail, fieldRecipeContext: IFieldRecipeContext): XMLFieldDetail {

        const valueSetValues = stagedField.valueSetName !== '' ? fieldRecipeContext.valueSetValuesForExpressions.get(stagedField.valueSetName.toLowerCase()) : undefined;
        const picklistValues = valueSetValues ?? stagedField.picklistValues;

        return Object.assign(new XMLFieldDetail(), {
            apiName: stagedField.fieldApiName,
            fieldType: stagedField.fieldType,
            fieldLabel: stagedField.fieldLabel,
            xmlMarkup: '',
            ...( stagedField.length !== undefined ? { length: stagedField.length } : {} ),
            ...( stagedField.precision !== undefined ? { precision: stagedField.precision } : {} ),
            ...( stagedField.scale !== undefined ? { scale: stagedField.scale } : {} ),
            ...( picklistValues.length > 0 ? { picklistValues: picklistValues.map(picklistValue => ({ picklistOptionApiName: picklistValue, label: picklistValue })) } : {} ),
            ...( stagedField.valueSetName !== '' ? { globalValueSetName: stagedField.valueSetName } : {} )
        });

    }

    // THE OBJECT'S OCCURRENCE IN THE RECIPE: THE FIELDS IT HAS A LINE FOR, AND WHETHER IT CARRIES RECORD TYPE SECTIONS
    private static scanRecipeObject(recipeContext: Pick<IObjectRefreshRecipeContext, 'recipeText' | 'objectNickname'>, objectApiName: string): IRecipeObjectScan {

        if ( recipeContext.recipeText === undefined ) {
            return { isObjectInRecipe: false, fieldApiNames: new Set(), hasRecordTypeSections: false };
        }

        const lines = RecipeCockpitRecipeWriter.splitRecipeLines(recipeContext.recipeText).lines;
        const scannedObject = RecipeCockpitRecipeWriter.scanRecipeObjects(lines).find(candidate => candidate.objectApiName === objectApiName
            && ( recipeContext.objectNickname === undefined || candidate.nicknames.includes(recipeContext.objectNickname) ));

        if ( !scannedObject ) {
            return { isObjectInRecipe: false, fieldApiNames: new Set(), hasRecordTypeSections: false };
        }

        return {
            isObjectInRecipe: true,
            fieldApiNames: new Set(scannedObject.fields.map(scannedField => scannedField.fieldApiName)),
            hasRecordTypeSections: RecipeCockpitRecipeWriter.hasRecordTypeSections(lines, scannedObject)
        };

    }

    // EVERY FIELD FILE OF THE OBJECT UNDER THE FOLDERS GIVEN, BY LOWER-CASED NAME; THE FIRST FOLDER WINS
    private static async readFieldDetails(workspaceRoot: string, relativeFolderPaths: readonly string[], objectApiName: string): Promise<Map<string, IOrgStagedFieldDetail>> {

        const fieldDetails = new Map<string, IOrgStagedFieldDetail>();

        for ( const relativeFolderPath of relativeFolderPaths ) {
            const { fields } = await RecipeCockpitOrgChangeDetection.readStagedObjectFields(workspaceRoot, path.resolve(workspaceRoot, relativeFolderPath), objectApiName);
            fields.forEach(field => {
                if ( !fieldDetails.has(field.fieldApiName.toLowerCase()) ) {
                    fieldDetails.set(field.fieldApiName.toLowerCase(), field);
                }
            });
        }

        return fieldDetails;

    }

    private static findDefaultObjectFolderPath(request: IObjectRefreshComparisonRequest): string {

        const resolvedWorkspaceRoot = path.resolve(request.workspaceRoot);
        const defaultRelativePath = path.relative(resolvedWorkspaceRoot, path.resolve(resolvedWorkspaceRoot, request.defaultPackageDirectoryPath));

        return RecipeCockpitMetadataDeploy.findObjectFolderPaths(resolvedWorkspaceRoot, [defaultRelativePath], [request.objectApiName]).get(request.objectApiName)?.[0]
            ?? path.join(resolvedWorkspaceRoot, defaultRelativePath, 'main', 'default', 'objects', request.objectApiName);

    }

    /*
        Each component file under the folders given, by lower-cased name: a folder that is a link is
        not listed, anything not a plain file is skipped, and a name that is not an api name is not
        read. The first folder holding a name wins.
    */
    private static listComponentFiles(folderPaths: readonly string[], fileSuffix: string): Map<string, IComponentFile> {

        const componentFiles = new Map<string, IComponentFile>();

        folderPaths.forEach(folderPath => {
            RecipeCockpitMetadataDeploy.listSubfolderEntries(path.dirname(folderPath), path.basename(folderPath))
                .filter(entry => entry.isFile() && entry.name.endsWith(fileSuffix))
                .map(entry => entry.name)
                .sort()
                .forEach(fileName => {
                    const componentName = fileName.slice(0, -fileSuffix.length);
                    if ( SalesforceApiName.isApiName(componentName) && !componentFiles.has(componentName.toLowerCase()) ) {
                        componentFiles.set(componentName.toLowerCase(), { componentName: componentName, filePath: path.join(folderPath, fileName) });
                    }
                });
        });

        return componentFiles;

    }

    private static async parseRoot(xmlText: string, rootElementName: string): Promise<Record<string, unknown> | undefined> {

        let parsed: unknown;
        try {
            parsed = await xml2js.parseStringPromise(xmlText);
        } catch {
            return undefined;
        }

        const parsedRecord = this.asRecord(parsed);
        return parsedRecord && Object.prototype.hasOwnProperty.call(parsedRecord, rootElementName) ? ( this.asRecord(parsedRecord[rootElementName]) ?? {} ) : undefined;

    }

    private static readText(candidate: unknown): string {
        const first = Array.isArray(candidate) ? candidate[0] : candidate;
        return typeof first === 'string' ? RecipeCockpitOrgChangeDetection.toSingleLine(first) : '';
    }

    private static showValue(value: string): string {
        return value === '' ? 'none' : RecipeCockpitOrgChangeDetection.cutForDisplay(value);
    }

    private static asRecord(candidate: unknown): Record<string, unknown> | undefined {
        return candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate as Record<string, unknown> : undefined;
    }

}

interface IRecipeObjectScan {
    isObjectInRecipe: boolean;
    fieldApiNames: ReadonlySet<string>;
    hasRecordTypeSections: boolean;
}

interface IFieldRecipeContext {
    request: IObjectRefreshComparisonRequest;
    recipeScan: IRecipeObjectScan;
    expressionSource: IObjectRefreshExpressionSource | undefined;
    // EACH ACTIVE STAGED RULE ANALYSED ONCE: ITS ANALYSIS BY LOWER-CASED RULE NAME, AND ITS CONSTRAINT BY LOWER-CASED FIELD
    stagedRuleAnalyses: IStagedRuleAnalyses;
    stagedFields: ReadonlyMap<string, IOrgStagedFieldDetail>;
    stagedValueSetValues: ReadonlyMap<string, string[]>;
    valueSetValuesForExpressions: ReadonlyMap<string, string[]>;
}

interface IStagedRuleAnalyses {
    analysesByLowerRuleName: Map<string, IValidationRuleAnalysis>;
    constraintsByLowerFieldName: Map<string, IValidationRuleFieldConstraint[]>;
}

interface IFieldRecipeRuleInput extends IFieldRecipeContext {
    fieldApiName: string;
    stagedField: IOrgStagedFieldDetail | undefined;
}

interface IFieldRecipeRule {
    name: string;
    holds: (ruleInput: IFieldRecipeRuleInput) => boolean;
    recipeNote: string;
}

interface IFieldRecipeDecision {
    recipeNote: string;
    recipeChanges: IObjectRefreshRecipeChange[];
}
