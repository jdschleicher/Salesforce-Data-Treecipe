import * as fs from 'fs';
import * as yaml from 'js-yaml';

import { faker } from '@faker-js/faker';

import { IFakerRecipeProcessor } from '../IFakerRecipeProcessor';
import { ErrorHandlingService } from '../../ErrorHandlingService/ErrorHandlingService';
import { GeneratedRecord, GeneratedRecordContext, ProcessedYamlWrapper } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/ProcessedYamlWrapper';

export class FakerJSRecipeProcessor implements IFakerRecipeProcessor {

    static baseFakerJSInstallationErrorMessage:string  = 'An error occurred in checking for snowfakery installation';
    static regExpressionForSurroundingFakerJSSyntax = /\${{(.*?)}}/g;
    
    async generateFakeDataBySelectedRecipeFile(fullRecipeFileNamePath: string) {

        const yamlContent = fs.readFileSync(fullRecipeFileNamePath, 'utf8'); // Read the YAML file
        const parsedData = yaml.load(yamlContent) as any[]; 
    
        let processedYamlWrapper:ProcessedYamlWrapper = {
            ObjectPropertyToExistingProcessedYaml: {},
            VariablePropertyToExistingProcessedYaml: {}
        };
    
        for (const entry of parsedData) {

            const objectType = entry.object;
            const variableName = entry.var;
            
            if ( objectType !== undefined && variableName === undefined ) {
                // handle object type declaration 
                // this function evaluates directly to generated data because it loops over fieleds that get pushed to generated data - could be refactored
                processedYamlWrapper = await this.processObjectDeclarationForYamlDocumentItem(objectType, entry, processedYamlWrapper);

            } else if ( variableName !== undefined && objectType === undefined ) {

                // handle variable type declaraition
                const variableFakerJSVariableEvaluation = await this.processVariableDeclarationForYamlDocumentItem(entry, processedYamlWrapper);
                processedYamlWrapper.VariablePropertyToExistingProcessedYaml[variableName] = variableFakerJSVariableEvaluation;

            } 

        };

        this.resolveNonAncestorNicknameReferences(processedYamlWrapper);
    
        const parsedObjectValuesOnly = Object.values(processedYamlWrapper.ObjectPropertyToExistingProcessedYaml).flat();
        const jsonGeneratedData = JSON.stringify(parsedObjectValuesOnly, null, 2);
        return jsonGeneratedData;

    }

    async processObjectDeclarationForYamlDocumentItem(objectType: string,
                                                        objectYamlEntry: any,
                                                        processedYamlWrapper: ProcessedYamlWrapper) {

        const nickname = objectYamlEntry.nickname;
        const originalYamlNickname: string = objectYamlEntry._originalYamlNickname || nickname;
        const count = objectYamlEntry.count || 1;
        const fieldsTemplate = objectYamlEntry.fields || {};
        const friends: any[] | undefined = objectYamlEntry.friends;
        const inheritedAncestorNicknames: Map<string, string> = objectYamlEntry._ancestorNicknameToEffectiveNickname ?? new Map<string, string>();
        const ancestorResolvedFieldNames: Set<string> = objectYamlEntry._ancestorResolvedFieldNames ?? new Set<string>();

        const hasActiveFriendsBlock = friends && Array.isArray(friends) && friends.length > 0;
        const requiresPerIterationNickname = hasActiveFriendsBlock && count > 1;

        for (let i = 0; i < count; i++) {

            const parentIterationIndex = i + 1;
            const effectiveNickname = requiresPerIterationNickname
                ? `${nickname}_${parentIterationIndex}`
                : nickname;

            let fieldApiNameByFakerJSEvaluations: Record<string, string> = {};
            for (const [yamlFieldName, yamlFieldValue] of Object.entries(fieldsTemplate)) {

                try {

                    fieldApiNameByFakerJSEvaluations[yamlFieldName] = await this.evaluateProvidedYamlPropertyValue(yamlFieldValue,
                                                                                                                    fieldApiNameByFakerJSEvaluations,
                                                                                                                    yamlFieldName,
                                                                                                                    processedYamlWrapper);

                } catch (error) {

                    const executedCommand = "FakerJSRecipeProcessor.generateFakeDataBySelectedRecipeFile";
                    const customErrorMessage = `Error evaluating faker-js expression syntax << ${yamlFieldName} - ${ yamlFieldValue } >> - ${error.message}`;

                    const customFakerJSEvaluationError = new Error();
                    customFakerJSEvaluationError.message = customErrorMessage;

                    customFakerJSEvaluationError.name = "FakerJSExpressionEvaluationError";
                    customFakerJSEvaluationError.stack = error.stack;

                    customFakerJSEvaluationError.cause = error.message;

                    ErrorHandlingService.createFakerExpressionEvaluationErrorCaptureFile(customFakerJSEvaluationError, executedCommand);

                    throw customFakerJSEvaluationError;

                }

            }

            const newFieldConfigurationToObject: GeneratedRecord = {
                id: parentIterationIndex,
                object: objectType,
                nickname: effectiveNickname,
                fields: fieldApiNameByFakerJSEvaluations,
            };

            processedYamlWrapper.GeneratedRecordContexts ??= [];
            processedYamlWrapper.GeneratedRecordContexts.push({
                record: newFieldConfigurationToObject,
                yamlNickname: typeof originalYamlNickname === 'string' ? originalYamlNickname : undefined,
                ancestorResolvedFieldNames: ancestorResolvedFieldNames
            });

            if ( processedYamlWrapper.ObjectPropertyToExistingProcessedYaml[objectType] === undefined ) {

                processedYamlWrapper.ObjectPropertyToExistingProcessedYaml[objectType] = [ newFieldConfigurationToObject ];

            } else {

                processedYamlWrapper.ObjectPropertyToExistingProcessedYaml[objectType].push(newFieldConfigurationToObject);

            }

            if (hasActiveFriendsBlock) {

                const parentNicknameForChildren = effectiveNickname || objectType;

                // EVERY ANCESTOR ON THE CHAIN, NOT ONLY THIS PARENT: A GRANDCHILD'S LOOKUP TO THE TOP PARENT NAMES THE TOP PARENT'S YAML NICKNAME (#46)
                const ancestorNicknameToEffectiveNickname = new Map(inheritedAncestorNicknames);
                if ( originalYamlNickname ) {
                    ancestorNicknameToEffectiveNickname.set(originalYamlNickname, effectiveNickname);
                }

                for (const friendEntry of friends) {
                    const friendObjectType = friendEntry.object;
                    const generatedFriendNickname = `${friendObjectType}_${parentNicknameForChildren}`;

                    const updatedFriendFields = this.replaceAncestorNicknameReferencesInFriendFields(
                        friendEntry.fields,
                        ancestorNicknameToEffectiveNickname
                    );

                    const friendAncestorResolvedFieldNames = new Set(Object.entries(friendEntry.fields ?? {})
                        .filter(([, fieldValue]) => typeof fieldValue === 'string' && ancestorNicknameToEffectiveNickname.has(fieldValue))
                        .map(([fieldName]) => fieldName));

                    const friendEntryWithContext = {
                        ...friendEntry,
                        fields: updatedFriendFields,
                        nickname: generatedFriendNickname,
                        _originalYamlNickname: friendEntry.nickname,
                        _ancestorNicknameToEffectiveNickname: ancestorNicknameToEffectiveNickname,
                        _ancestorResolvedFieldNames: friendAncestorResolvedFieldNames,
                    };

                    processedYamlWrapper = await this.processObjectDeclarationForYamlDocumentItem(
                        friendObjectType,
                        friendEntryWithContext,
                        processedYamlWrapper
                    );
                }

            }

        }

        return processedYamlWrapper;

    }

    /*
        A field whose value is EXACTLY an ancestor's YAML nickname is pointed at the record of that
        ancestor this friend is being generated under. A Map rather than an object, because a
        nickname is text from the recipe and could be "__proto__".
    */
    replaceAncestorNicknameReferencesInFriendFields(
        fields: Record<string, any> | undefined,
        ancestorNicknameToEffectiveNickname: Map<string, string>
    ): Record<string, any> {

        if (!fields) {
            return {};
        }

        const updatedFields: Record<string, any> = {};
        for (const [fieldName, fieldValue] of Object.entries(fields)) {
            updatedFields[fieldName] = ( typeof fieldValue === 'string' && ancestorNicknameToEffectiveNickname.has(fieldValue) )
                ? ancestorNicknameToEffectiveNickname.get(fieldValue)
                : fieldValue;
        }
        return updatedFields;

    }

    /*
        Run once the WHOLE recipe has been generated, so a reference resolves whichever comes first in
        the file (#189). A field whose value is EXACTLY the YAML nickname of an entry, and which was
        not already pointed at an ancestor, is pointed at one of the records that entry generated:
        round-robin, in generation order, so a data set is repeatable and children spread evenly. A
        record is never pointed at itself.

        The insert resolves a nickname to the FIRST record holding it, and an entry with count > 1
        and no friends gives every record the same nickname -- so only for an entry a reference
        actually names, each record sharing its nickname is renamed <nickname>_<n>, and a data set
        that names none is written exactly as before. Those records have no friends, so nothing was
        generated under the old name.
    */
    resolveNonAncestorNicknameReferences(processedYamlWrapper: ProcessedYamlWrapper): void {

        const generatedRecordContexts = processedYamlWrapper.GeneratedRecordContexts ?? [];

        // A Map RATHER THAN AN OBJECT, BECAUSE A NICKNAME IS TEXT FROM THE RECIPE AND COULD BE "__proto__"
        const recordContextsByYamlNickname = new Map<string, GeneratedRecordContext[]>();
        generatedRecordContexts.forEach(recordContext => {
            if ( recordContext.yamlNickname === undefined ) {
                return;
            }
            const recordContextsOfYamlNickname = recordContextsByYamlNickname.get(recordContext.yamlNickname);
            if ( recordContextsOfYamlNickname ) {
                recordContextsOfYamlNickname.push(recordContext);
            } else {
                recordContextsByYamlNickname.set(recordContext.yamlNickname, [recordContext]);
            }
        });

        const references: { recordContext: GeneratedRecordContext, fieldName: string, yamlNickname: string }[] = [];
        generatedRecordContexts.forEach(recordContext => {
            Object.entries(recordContext.record.fields ?? {}).forEach(([fieldName, fieldValue]) => {
                if ( typeof fieldValue === 'string'
                        && !recordContext.ancestorResolvedFieldNames.has(fieldName)
                        && recordContextsByYamlNickname.has(fieldValue) ) {
                    references.push({ recordContext, fieldName, yamlNickname: fieldValue });
                }
            });
        });

        if ( references.length === 0 ) {
            return;
        }

        const usedNicknames = new Set(generatedRecordContexts.map(recordContext => recordContext.record.nickname));
        new Set(references.map(reference => reference.yamlNickname)).forEach(yamlNickname => {
            this.renameRecordsSharingANickname(recordContextsByYamlNickname.get(yamlNickname).map(recordContext => recordContext.record), usedNicknames);
        });

        const nextRecordIndexByYamlNickname = new Map<string, number>();
        references.forEach(({ recordContext, fieldName, yamlNickname }) => {

            const candidateRecords = recordContextsByYamlNickname.get(yamlNickname)
                .map(candidateContext => candidateContext.record)
                .filter(candidateRecord => candidateRecord !== recordContext.record);
            if ( candidateRecords.length === 0 ) {
                return;
            }

            const nextRecordIndex = nextRecordIndexByYamlNickname.get(yamlNickname) ?? 0;
            recordContext.record.fields[fieldName] = candidateRecords[nextRecordIndex % candidateRecords.length].nickname;
            nextRecordIndexByYamlNickname.set(yamlNickname, nextRecordIndex + 1);

        });

    }

    private renameRecordsSharingANickname(records: GeneratedRecord[], usedNicknames: Set<string>): void {

        const recordsByNickname = new Map<string, GeneratedRecord[]>();
        records.forEach(record => {
            const recordsOfNickname = recordsByNickname.get(record.nickname);
            if ( recordsOfNickname ) {
                recordsOfNickname.push(record);
            } else {
                recordsByNickname.set(record.nickname, [record]);
            }
        });

        recordsByNickname.forEach((recordsSharingNickname, sharedNickname) => {
            if ( recordsSharingNickname.length < 2 || typeof sharedNickname !== 'string' ) {
                return;
            }
            let suffix = 1;
            recordsSharingNickname.forEach(record => {
                while ( usedNicknames.has(`${sharedNickname}_${suffix}`) ) {
                    suffix++;
                }
                record.nickname = `${sharedNickname}_${suffix}`;
                usedNicknames.add(record.nickname);
            });
        });

    }

    static buildRecipeDataStructureSummary(parsedYaml: any[]): string {

        const lines: string[] = ['The following records will be created in the org:\n'];
        let totalRecords = 0;

        const traverseEntry = (entry: any, indent: string, parentMultiplier: number) => {
            if (!entry.object) { return; }

            const count = (entry.count || 1) as number;
            const totalForThisLevel = count * parentMultiplier;
            totalRecords += totalForThisLevel;

            const countDetail = parentMultiplier > 1
                ? `${count} per parent  →  ${totalForThisLevel} total`
                : `${totalForThisLevel} total`;
            lines.push(`${indent}${entry.object}: ${countDetail}`);

            if (entry.friends && Array.isArray(entry.friends)) {
                for (const friend of entry.friends) {
                    traverseEntry(friend, `${indent}  └─ `, totalForThisLevel);
                }
            }
        };

        for (const entry of parsedYaml) {
            if (entry.object) {
                traverseEntry(entry, '  ', 1);
            }
        }

        lines.push(`\nTotal records: ${totalRecords}`);
        return lines.join('\n');

    }

    async processVariableDeclarationForYamlDocumentItem(varYamlEntry: any, processedYamlData: any) {
        
        let fakerJSVariableEvaluation:any;
    
        try {

            let emptyFieldToPropertyEvaluations:Record<string, string> = null;
            fakerJSVariableEvaluation = await this.evaluateProvidedYamlPropertyValue(varYamlEntry.value, 
                                                                                        emptyFieldToPropertyEvaluations, 
                                                                                        varYamlEntry.name,
                                                                                        processedYamlData);

        } catch (error) {
            
            const executedCommand = "FakerJSRecipeProcessor.processVariableDeclarationForYamlDocumentItem";
            const customErrorMessage = `Error evaluating faker-js expression syntax << ${varYamlEntry.var} - ${ varYamlEntry.value } >> - ${error.message}`;
            
            const customFakerJSEvaluationError = new Error();
            customFakerJSEvaluationError.message = customErrorMessage;
    
            customFakerJSEvaluationError.name = "FakerJSExpressionEvaluationError";
            customFakerJSEvaluationError.stack = error.stack;
    
            customFakerJSEvaluationError.cause = error.message;
    
            ErrorHandlingService.createFakerExpressionEvaluationErrorCaptureFile(customFakerJSEvaluationError, executedCommand);
            
            throw customFakerJSEvaluationError;
                        
        }

        return fakerJSVariableEvaluation;

    }

    transformFakerJsonDataToCollectionApiFormattedFilesBySObject(fakerContent: string): Map<string, CollectionsApiJsonStructure> {

        const objectApiToGeneratedRecords = new Map<string, CollectionsApiJsonStructure>();

        const fakerJSRecords = JSON.parse(fakerContent);
        fakerJSRecords.forEach(record => {

            const objectApiName = record.object;
            const recordTrackingReferenceId = this.createCombinedNickNameReferenceForRecord(
                objectApiName,
                record
            );
            const sobjectGeneratedDetail = {
                attributes: {
                    type: objectApiName,
                    referenceId: recordTrackingReferenceId
                },
                ...record.fields
            };
          
            // remove unneeded properties
            delete sobjectGeneratedDetail.object;
            delete sobjectGeneratedDetail.id;
            delete sobjectGeneratedDetail.nickname;

            if (objectApiToGeneratedRecords.has(objectApiName)) {

                objectApiToGeneratedRecords.get(objectApiName).records.push(sobjectGeneratedDetail);

            } else {

                const objectApiToRecords:CollectionsApiJsonStructure = {
                    allOrNone: true,
                    records: [sobjectGeneratedDetail] 
                };

                objectApiToGeneratedRecords.set(objectApiName, objectApiToRecords);

            }

        });

        return objectApiToGeneratedRecords;
    
    }

    createCombinedNickNameReferenceForRecord(objectApiName:string, recordDetail: any):string {

        let referenceTrackingId = `${objectApiName}_Reference_${recordDetail.id}`;
        if ( recordDetail.nickname ) {
            referenceTrackingId = `${referenceTrackingId}__${recordDetail.nickname}`;
        }

        return referenceTrackingId;

    }

    async evaluateProvidedYamlPropertyValue(providedYamlPropertyValue: any, 
                                    fieldApiNameByFakerJSEvaluations: Record<string, string>,
                                    yamlPropertyFieldApiNameToEvaluate: string,
                                    alreadyProcessedYamlWrapper: ProcessedYamlWrapper): Promise<string> {

        
        let processedYamlPropertyValue = null;

        const fakerJSExpressionStartIndicator = "${{";
        const fakerJSExpressionStopIndicator = "${{";
        const containsExpressionSyntax = (typeof providedYamlPropertyValue === 'string' 
                                        && providedYamlPropertyValue.includes(fakerJSExpressionStartIndicator) 
                                        && providedYamlPropertyValue.includes(fakerJSExpressionStopIndicator) );

        if ( containsExpressionSyntax ) {
            
            processedYamlPropertyValue = await this.getFakeValueFromFakerJSExpression(providedYamlPropertyValue, alreadyProcessedYamlWrapper.VariablePropertyToExistingProcessedYaml);

        } else {

            processedYamlPropertyValue = this.handleNonFakerJSExpressionSyntaxValueScenarios(providedYamlPropertyValue, 
                                                                                                fieldApiNameByFakerJSEvaluations, 
                                                                                                yamlPropertyFieldApiNameToEvaluate);
        
        }

        return processedYamlPropertyValue;

    }

    getVariableValueFromExistingProcessedYamlProperties(variableToAlreadyEvaluatedValueReferenceMap: Record<string, any>, variableNameFromExpression) {

        let yamlValueFromVariable = null;

        const fromPreviousGenerated = variableToAlreadyEvaluatedValueReferenceMap[variableNameFromExpression];
        if ( fromPreviousGenerated !== undefined ) {
            yamlValueFromVariable = fromPreviousGenerated;
        } else {
            const missingVariableKeyReferenceTodoMessage = "### TODO : THIS VARIABLE SETTING IS MADE BEFORE THE ACTUAL VARIABLE OBJECT. MOVE THE VARIABLE DELCARATION '- var: vaiable name ' ABOVE THIS SECTION OF THE RECIPE";
            yamlValueFromVariable = missingVariableKeyReferenceTodoMessage;
        }

        return yamlValueFromVariable;

    }

    extractVariableNameFromExpressionSyntax(input: string): string {
        const pattern = /\bvar\.([a-zA-Z_][a-zA-Z0-9_]*)\b/;
        const match = input.match(pattern);
        return match ? match[1] : null;

    }


    handleNonFakerJSExpressionSyntaxValueScenarios(providedYamlPropertyValue: any,
                                                    fieldApiNameByFakerJSEvaluations,
                                                    yamlPropertyFieldApiNameToEvaluate): any {

        let evaluatedYamlPropertyValue = null;
        const dependentPicklistKeyIndicator = "if";
        // A COMMENT-ONLY FIELD (A "### TODO" VALUE) LOADS AS null, AND "in" THROWS ON null AND ON NUMBERS
        if ( (typeof providedYamlPropertyValue === 'object')
                && (providedYamlPropertyValue !== null)
                && (dependentPicklistKeyIndicator in providedYamlPropertyValue) 
                && Object.keys(providedYamlPropertyValue).length === 1 ) {
    
                const evaluatedRandomChoiceFromAvailablePicklistDependencyOptions = this.evaluateDependentPicklistFakerJSExpression(providedYamlPropertyValue, 
                                                                                                                                    fieldApiNameByFakerJSEvaluations, 
                                                                                                                                    yamlPropertyFieldApiNameToEvaluate);
                evaluatedYamlPropertyValue = evaluatedRandomChoiceFromAvailablePicklistDependencyOptions;

        } else {

            /*
                if no expected faker-js expression syntax, 
                field value may be hard coded string or special value 
                like object nickname or record type api name
             */

            evaluatedYamlPropertyValue = providedYamlPropertyValue;
        }

        return evaluatedYamlPropertyValue;

    }

    evaluateDependentPicklistFakerJSExpression(dependentPicklistfakerJSExpressionDetail:any,  
                                                fieldApiNameByFakerJSEvaluations: Record<string, string>,
                                                fieldApiNameToEvaluate: string): Promise<string> {

        let evaluatedPicklistDependencyOptions;

        const choices = dependentPicklistfakerJSExpressionDetail.if;

        const whenIndicatorInYamlExpression = choices.length > 0 ? choices[0].choice.when : '';
        if (!whenIndicatorInYamlExpression) {
            throw new Error('No choices available in the YAML data');
        }
    
        const firstWhenCondition = this.parseWhenCondition(whenIndicatorInYamlExpression);
        if ( !firstWhenCondition ) {
            throw new Error('Incorrect format for dependent picklist faker value. Should match the following pattern: \"${{ PicklistApiName__c == \'picklistValue\' }}\"');
        }
    
        let expectedExistingControllingFieldApiNameForDependentPicklist = firstWhenCondition.controllingFieldApiName;
        if (!fieldApiNameByFakerJSEvaluations || !fieldApiNameByFakerJSEvaluations[expectedExistingControllingFieldApiNameForDependentPicklist]) {
            throw new Error(`Field "${expectedExistingControllingFieldApiNameForDependentPicklist}" not found in existing field evaluations`);
        }

        const controllingFieldPicklistValue = fieldApiNameByFakerJSEvaluations[expectedExistingControllingFieldApiNameForDependentPicklist];
        const matchingControllingFieldGeneratedValueSection = choices.find(item => {

            const whenCondition = this.parseWhenCondition(item.choice.when);
            return whenCondition !== null && whenCondition.controllingValue === controllingFieldPicklistValue;

        });
        
        if ( matchingControllingFieldGeneratedValueSection ) {

            const availablePicklistOptions = matchingControllingFieldGeneratedValueSection.choice.pick.random_choice;
            evaluatedPicklistDependencyOptions = faker.helpers.arrayElement(availablePicklistOptions);

        } else {

            throw new Error(`FakerJSRecipeProcessor: Expected processed and matching value 
                of controlling picklist field: ${expectedExistingControllingFieldApiNameForDependentPicklist}
                , no existing matching value for dependent picklist ${fieldApiNameToEvaluate}`);
            // may need to move controlling field up in object detail as its not in map yet

        }

        return evaluatedPicklistDependencyOptions;

    }

    /*
        The generator writes the controlling value as a single-quoted string ESCAPED for JavaScript
        (FakerJSRecipeFakerService.escapePicklistValueForJavaScriptString), because the value is
        untrusted and may carry a quote, "}}" or a line break. So it is read as a string literal --
        up to its unescaped closing quote -- and unescaped, never cut at the first "}}" or stripped
        of every quote, which made a value like Rock 'n' Roll match nothing.

        A condition that is not one quoted literal falls back to the original reading, so a recipe
        written by hand in the older shape still works.
    */
    parseWhenCondition(whenCondition: unknown): { controllingFieldApiName: string, controllingValue: string } | null {

        if ( typeof whenCondition !== 'string' ) {
            return null;
        }

        const quotedLiteralMatch = whenCondition.match(FakerJSRecipeProcessor.whenConditionWithQuotedLiteralRegex);
        if ( quotedLiteralMatch ) {
            const [, controllingFieldApiName, , escapedControllingValue] = quotedLiteralMatch;
            return {
                controllingFieldApiName: controllingFieldApiName,
                controllingValue: FakerJSRecipeProcessor.unescapeJavaScriptStringLiteralContent(escapedControllingValue)
            };
        }

        const legacyMatch = whenCondition.match(FakerJSRecipeProcessor.legacyWhenConditionRegex);
        if ( !legacyMatch ) {
            return null;
        }

        const expectedQuotesAroundPicklistWhenSelection = /['"]/g;
        return {
            controllingFieldApiName: legacyMatch[1],
            controllingValue: legacyMatch[2].trim().replace(expectedQuotesAroundPicklistWhenSelection, '')
        };

    }

    static legacyWhenConditionRegex = FakerJSRecipeProcessor.prototype.buildWhenConditionRegexMatchForControllingField();

    static whenConditionWithQuotedLiteralRegex = /^\s*\$\{\{\s*(\S+?)\s*==\s*(['"])((?:\\[\s\S]|(?!\2)[^\\])*)\2\s*\}\}\s*$/;

    static unescapeJavaScriptStringLiteralContent(escapedContent: string): string {

        return escapedContent.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (fullEscape: string, escapeBody: string) => {

            if ( escapeBody.startsWith('u{') ) {
                const codePoint = parseInt(escapeBody.slice(2, -1), 16);
                return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : fullEscape;
            }
            if ( escapeBody.length > 1 ) {
                return String.fromCharCode(parseInt(escapeBody.slice(1), 16));
            }

            const singleCharacterEscapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' };
            return singleCharacterEscapes[escapeBody] ?? escapeBody;

        });

    }

    buildWhenConditionRegexMatchForControllingField() {

        const openingExpressionSyntaxLiteral = "\{\\{";
        const whitespaceMatch = "\\s*";
        const allContentBeforeDoubleEqual = "(.*?)";
        const whitespaceFollowingExpectedApiName = "\\s*";
        const doubleEqualsLiteral = "==";
        const allContentAfterDoubleEqual = "(.*?)";
        const closingExpressionSyntaxLiteral = "\}\\}";

        const controllingFieldRegex = new RegExp(openingExpressionSyntaxLiteral 
                                                + whitespaceMatch 
                                                + allContentBeforeDoubleEqual 
                                                + whitespaceFollowingExpectedApiName 
                                                + doubleEqualsLiteral
                                                + allContentAfterDoubleEqual
                                                + closingExpressionSyntaxLiteral); 

        return controllingFieldRegex;

    }   

    async getFakeValueFromFakerJSExpression(fakerJSExpression: string, variableToEvaluatedValueReferenceMap): Promise<string> {

        const regexExpressionForFakerSyntaxBookEnds = FakerJSRecipeProcessor.regExpressionForSurroundingFakerJSSyntax;
        const expressionSyntaxMatches = [...fakerJSExpression.matchAll(regexExpressionForFakerSyntaxBookEnds)];

        let originalExpressionCopyForFakerEvalReplacements = fakerJSExpression;

        for (let i = expressionSyntaxMatches.length - 1; i >= 0; i--) {
            
            const expressionMatch = expressionSyntaxMatches[i];
            const [fullIndexMatch, fakerJSCode] = expressionMatch;

            const matchIndex = expressionMatch.index; 
            const matchCharactersLength = fullIndexMatch.length;
            const trimmedFakerJSCode = fakerJSCode.trim();

            let processedYamlPropertyValueFromExpression = null;
            const variableNameFromExpressionSyntax = this.extractVariableNameFromExpressionSyntax(trimmedFakerJSCode);
            if ( variableNameFromExpressionSyntax !== null ) {

                processedYamlPropertyValueFromExpression = this.getVariableValueFromExistingProcessedYamlProperties(variableToEvaluatedValueReferenceMap, variableNameFromExpressionSyntax);

            } else {

                processedYamlPropertyValueFromExpression = this.getFakerJSExpressionEvaluation(trimmedFakerJSCode);

            }         

            
            
            originalExpressionCopyForFakerEvalReplacements = originalExpressionCopyForFakerEvalReplacements.substring(0, matchIndex) + 
                                                                processedYamlPropertyValueFromExpression + 
                                                                originalExpressionCopyForFakerEvalReplacements.substring(matchIndex + matchCharactersLength);
        
        }

        return originalExpressionCopyForFakerEvalReplacements;

    }

    getFakerJSExpressionEvaluation(trimmedFakerJSCode) {

        let fakerEvalExpressionResult;
            
        try {

            const preparedCode = this.prepareFakerDateSyntax(trimmedFakerJSCode);
            
            const evaluationFunction = new Function(
                'faker',
                'dateUtils',
                `return (${preparedCode})`
            );
            
            // Execute the function with all necessary dependencies
            fakerEvalExpressionResult = evaluationFunction(
                faker, 
                this.dateUtils
            );
            
        } catch (error) {
            throw new Error(`getFakeValueFromFakerJSExpression: Error evaluating expression: ${trimmedFakerJSCode} - ${error.message}`);
        }

        return fakerEvalExpressionResult;  

    }

    prepareFakerDateSyntax(originalCode) {

        const {
            dateBetweenRegex,
            datetimeBetweenRegex,
            dateRegex,
            datetimeRegex,
            matchingCustomFunctionRegex
        } = this.getExpectedDateRegExPatterns();

        let modifiedCode = originalCode;

        // Replace date_between
        modifiedCode = modifiedCode.replace(dateBetweenRegex, (_match: string, fromValue: string, toValue: string) => {

            return `dateUtils.date_between({from: '${fromValue}', to: '${toValue}'})`;

        });

        // Replace datetime_between
        modifiedCode = modifiedCode.replace(datetimeBetweenRegex, (_match: string, fromValue: string, toValue: string) => {

            return `dateUtils.datetime_between({from: '${fromValue}', to: '${toValue}'})`;

        });

        // Replace date
        modifiedCode = modifiedCode.replace(dateRegex, (_match: string, inputValue: string) => {

            return `dateUtils.date('${inputValue}')`;

        });

        // Replace datetime
        modifiedCode = modifiedCode.replace(datetimeRegex, (_match: string, inputValue: string) => {

            return `dateUtils.datetime('${inputValue}')`;

        });

        return modifiedCode;

    }

    // THESE DATE UTILS ARE LEVERAGED AS PART OF THE prepareFakerDateSyntax FUNCTION
    dateUtils = {
        
        date(input) {

          const parsedInput = this.parseRelativeDate(input);
          
          if (parsedInput instanceof Date) {
            return parsedInput.toISOString().split('T')[0];
          }
          
          return parsedInput;
        },
        
        datetime(input) {
          return this.parseRelativeDate(input, true);
        },
      
        // Date range generation functions
        date_between({ from, to }) {
            const fromResult = this.parseRelativeDate(from);
            const toResult = this.parseRelativeDate(to);

            const fakerDate = faker.date.between({
                from: fromResult,
                to: toResult
            }).toISOString().split('T')[0];

            return fakerDate;
        },
      
        datetime_between({ from, to }) {

            const fromResult = this.parseRelativeDate(from, true);
            const toResult = this.parseRelativeDate(to, true);

            const fakerDate = faker.date.between({
                from: fromResult,
                to: toResult
            }).toISOString();

            return fakerDate;
        },

        parseRelativeDate(dateArgument, isDateTime = false) {
       
            // Trim whitespace
            dateArgument = dateArgument.trim();

            // If it's already a valid JavaScript date expression, return as-is
            const startOfLine = '^';
            const optionalWhitespaceStart = '\\s*';
            const optionalOpeningQuote = "['\"]?";  // matches ' or "
            const datePattern = '\\d{4}-\\d{2}-\\d{2}';  // yyyy-mm-dd
            const optionalClosingQuote = "['\"]?";
            const optionalWhitespaceEnd = '\\s*';
            const endOfLine = '$';
            const combinedDateRegexPattern = startOfLine 
                                                + optionalWhitespaceStart 
                                                + optionalOpeningQuote 
                                                + datePattern 
                                                + optionalClosingQuote 
                                                + optionalWhitespaceEnd 
                                                + endOfLine;

            const dateYYYYMMDDRegexPattern = new RegExp(combinedDateRegexPattern);
            if (!dateArgument 
                || typeof dateArgument === 'object' 
                || dateYYYYMMDDRegexPattern.test(dateArgument)) {

                return dateArgument;

            }
            
            // Check for special keywords
            if (dateArgument.toLowerCase() === 'today') {
                const todaysDate = new Date();
                const todaysDateFormatted = (isDateTime)
                                        ? todaysDate.toISOString() 
                                        : todaysDate.toISOString().split('T')[0];
                return todaysDateFormatted;
            }
            
            // Handle relative date syntax
            const expectedSyntaxForDayIncreaseOrDecreaseRegexMatch = /^([+-])(\d+)$/;
            const matches = dateArgument.match(expectedSyntaxForDayIncreaseOrDecreaseRegexMatch);
            if (matches) {
                const [, sign, days] = matches;
                const date = new Date();
                
                // Adjust the date based on the sign
                const daysToShift = parseInt(days);
   
                if (sign === '+') {
                    date.setDate(date.getDate() + daysToShift);
                } else {
                    date.setDate(date.getDate() - daysToShift);
                }

                const minSalesforceDate = new Date('0001-01-01T00:00:00.000Z');
                const maxSalesforceDate = new Date('9999-12-31T23:59:59.999Z');

                const isWithinSalesforceDateRange = (date.getTime() >= minSalesforceDate.getTime() 
                                                        && date.getTime() <= maxSalesforceDate.getTime());

                if (!isWithinSalesforceDateRange) {
                    throw new Error(`Shifted date "${sign}${days}" is outside the valid Salesforce date range. minimum date is 0001-01-01 and maximum date is 9999-12-31.`);
                }

                const formattedDate = isDateTime ?
                                        date.toISOString()
                                        : date.toISOString().split('T')[0];

                return formattedDate;
            }
            
            // If no special syntax is found, return the original input
            const dateArgumentTodoSyntax = `${dateArgument} ### TODO: THIS MAY NOT BE A VALID DATE VALUE`;
            return dateArgumentTodoSyntax;
    
        }

    };
      
    getExpectedDateRegExPatterns() {

        // Whitespace handling
        const OPTIONAL_WHITESPACE = '\\s*';
        
        // Quote handling
        const OPTIONAL_QUOTE = '[\'\""]?';
        
        // Value capture (supports relative dates, 'today', and hardcoded dates)
        const VALUE_CAPTURE = "([^'\"},]+)";
        
        // Expected "Date" function expression patterns
        const DATE_BETWEEN_NAME = 'date_between';
        const DATETIME_BETWEEN_NAME = 'datetime_between';
        const DATE_NAME = 'date';
        const DATETIME_NAME = 'datetime';
        
        // Literal regex components
        const OPENING_PARENTHESIS = '\\(';
        const CLOSING_PARENTHESIS = '\\)';
        const OPENING_BRACE = '\\{';
        const CLOSING_BRACE = '\\}';
        
        // Parameter name components
        const FROM_PARAM = 'from:';
        const TO_PARAM = 'to:';
        
        const dateBetweenRegex = new RegExp(
          `${DATE_BETWEEN_NAME}${OPENING_PARENTHESIS}${OPTIONAL_WHITESPACE}` +
          `${OPENING_BRACE}${OPTIONAL_WHITESPACE}` +
          `${FROM_PARAM}${OPTIONAL_WHITESPACE}${OPTIONAL_QUOTE}${VALUE_CAPTURE}${OPTIONAL_QUOTE}` +
          `${OPTIONAL_WHITESPACE},${OPTIONAL_WHITESPACE}` +
          `${TO_PARAM}${OPTIONAL_WHITESPACE}${OPTIONAL_QUOTE}${VALUE_CAPTURE}${OPTIONAL_QUOTE}` +
          `${OPTIONAL_WHITESPACE}${CLOSING_BRACE}${OPTIONAL_WHITESPACE}` +
          `${CLOSING_PARENTHESIS}`
        );
      
        const datetimeBetweenRegex = new RegExp(
          `${DATETIME_BETWEEN_NAME}${OPENING_PARENTHESIS}${OPTIONAL_WHITESPACE}` +
          `${OPENING_BRACE}${OPTIONAL_WHITESPACE}` +
          `${FROM_PARAM}${OPTIONAL_WHITESPACE}${OPTIONAL_QUOTE}${VALUE_CAPTURE}${OPTIONAL_QUOTE}` +
          `${OPTIONAL_WHITESPACE},${OPTIONAL_WHITESPACE}` +
          `${TO_PARAM}${OPTIONAL_WHITESPACE}${OPTIONAL_QUOTE}${VALUE_CAPTURE}${OPTIONAL_QUOTE}` +
          `${OPTIONAL_WHITESPACE}${CLOSING_BRACE}${OPTIONAL_WHITESPACE}` +
          `${CLOSING_PARENTHESIS}`
        );
      
        const dateRegex = new RegExp(
          `${DATE_NAME}${OPENING_PARENTHESIS}${OPTIONAL_WHITESPACE}` +
          `${OPTIONAL_QUOTE}${VALUE_CAPTURE}${OPTIONAL_QUOTE}${OPTIONAL_WHITESPACE}` +
          `${CLOSING_PARENTHESIS}`
        );
      
        const datetimeRegex = new RegExp(
          `${DATETIME_NAME}${OPENING_PARENTHESIS}` +
          `${OPTIONAL_QUOTE}${VALUE_CAPTURE}${OPTIONAL_QUOTE}${OPTIONAL_WHITESPACE}` +
          `${CLOSING_PARENTHESIS}`
        );

        // THE BELOW FUNCTION NAMES INCLUDE OPENING PARENTHESIS TO DIFFERENTIATE THEM FROM COMMON USE CASES OF "new Date" AND "faker.date.between"
        const fakerCustomDateMethods = [
            DATETIME_BETWEEN_NAME,
            DATE_BETWEEN_NAME,
            DATE_NAME,
            DATETIME_NAME
        ];

        const OR_OPERATOR_REGEX = '|';
        
        // Create individual name patterns
        const individualMethodNameMatchingPattern = fakerCustomDateMethods.map(name => `${name}${OPENING_PARENTHESIS}`);
        const combinedPatterns = individualMethodNameMatchingPattern.join(OR_OPERATOR_REGEX);
        const matchingCustomFunctionRegex = new RegExp(combinedPatterns);
      
        return {
            dateBetweenRegex,
            datetimeBetweenRegex,
            dateRegex,
            datetimeRegex,
            matchingCustomFunctionRegex
        };
      
    }

}





