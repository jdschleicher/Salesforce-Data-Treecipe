import { IPicklistDependencySpecDetail } from '../PicklistDependencyTestService/PicklistDependencyTestService';

/*
    How a field file lays its valueSettings out.

    Salesforce retrieves the grouped form -- one block per dependent value, carrying every
    controlling value that unlocks it -- but the flat form, one block per pair, is equally valid and
    is what several files in this repository use. Writeback preserves whichever a file already has:
    rewriting a file into the other shape would turn the first reconciliation into a restructure of
    every block, which is the sprawling diff deterministic emission exists to avoid.
*/
export type PicklistDependencyValueSettingsShape = 'grouped' | 'flat';

export interface IPicklistDependencyValueSettingsBlock {
    valueName: string;
    controllingValues: string[];
    startIndex: number;
    endIndex: number;
}

export interface IPicklistDependencyValueSettingsRegion {
    blocks: IPicklistDependencyValueSettingsBlock[];
    shape: PicklistDependencyValueSettingsShape;
    // WHERE THE CONTIGUOUS RUN OF BLOCKS BEGINS AND ENDS, WHICH IS THE ONLY SPAN WRITEBACK REPLACES
    startIndex: number;
    endIndex: number;
    indentation: string;
    /*
        The line ending the file already uses. Emitting "\n" into a CRLF file leaves the rewritten
        region with different endings from every line around it, which shows up as a whole-region
        diff on a Windows checkout -- the noise deterministic emission exists to remove.
    */
    lineEnding: string;
}

/*
    Why a field could not be reconciled, in words the command can show.

    A refusal is per FIELD rather than per run: one field that cannot be written safely does not
    stop the fields that can, for the same reason a skipped field does not abort generation.
*/
export interface IPicklistDependencyWritebackRefusal {
    objectApiName: string;
    fieldApiName: string;
    reason: string;
}

export interface IPicklistDependencyFieldWritebackPlan {
    objectApiName: string;
    fieldApiName: string;
    fieldFilePath: string;
    proposedContent: string;
    hasChanges: boolean;
    // PAIRS AS THE READER THINKS OF THEM -- "cle unlocks plant" -- RATHER THAN AS BLOCKS
    addedPairs: string[];
    removedPairs: string[];
    addedPicklistValues: string[];
}

/*
    One field's outcome: either something to write, or a reason it was left alone.

    Exactly one of the two is set. A refusal is not an error -- the command reports it and carries
    on with the fields that can be reconciled, because one field that cannot be written safely
    should not cost the ones that can.
*/
export interface IPicklistDependencyFieldWritebackOutcome {
    plan?: IPicklistDependencyFieldWritebackPlan;
    refusal?: IPicklistDependencyWritebackRefusal;
}

export class PicklistDependencyMetadataWriterService {

    /*
        Every valueSettings block in a field file, with where it sits.

        Read off the raw markup rather than through xml2js because writeback edits the file in place:
        a parse-then-build round trip does not preserve Salesforce's formatting and would reformat
        every line of the file, producing exactly the diff this command exists to keep small.
    */
    static collectValueSettingsBlocks(fieldFileContent: string): IPicklistDependencyValueSettingsBlock[] {

        let blocks: IPicklistDependencyValueSettingsBlock[] = [];

        /*
            Commented-out markup is not markup. A valueSettings block inside an XML comment would
            otherwise be collected as real, and -- because the region is replaced as one span -- a
            comment opening just before the first real block would put the span's start inside it
            and strand a dangling "<!--" in the written file.

            Blanked to spaces rather than removed so every index this function reports still refers
            to the caller's original string.
        */
        const scannableContent = this.blankXmlComments(fieldFileContent);

        const blockPattern = /<valueSettings>([\s\S]*?)<\/valueSettings>/g;
        let blockMatch: RegExpExecArray | null;

        while ( ( blockMatch = blockPattern.exec(scannableContent) ) !== null ) {

            const blockBody = blockMatch[1];

            const valueNameMatch = /<valueName>([\s\S]*?)<\/valueName>/.exec(blockBody);

            if ( !valueNameMatch ) {
                continue;
            }

            let controllingValues: string[] = [];
            const controllingValuePattern = /<controllingFieldValue>([\s\S]*?)<\/controllingFieldValue>/g;
            let controllingValueMatch: RegExpExecArray | null;

            while ( ( controllingValueMatch = controllingValuePattern.exec(blockBody) ) !== null ) {
                controllingValues.push(this.decodeXmlText(controllingValueMatch[1]));
            }

            blocks.push({
                valueName: this.decodeXmlText(valueNameMatch[1]),
                controllingValues,
                startIndex: blockMatch.index,
                endIndex: blockMatch.index + blockMatch[0].length
            });

        }

        return blocks;

    }

    /*
        Every XML comment replaced by spaces of the same length, so offsets are unchanged.

        An unterminated comment blanks to end of file, which is the safe reading: markup after a
        "<!--" with no "-->" is inside the comment as far as any parser is concerned.
    */
    static blankXmlComments(fieldFileContent: string): string {

        return fieldFileContent.replace(/<!--[\s\S]*?(?:-->|$)/g, commentMarkup => ' '.repeat(commentMarkup.length));

    }

    /*
        Which shape a file uses, decided from what is actually in it.

        A block carrying more than one controlling value can only be the grouped form; nothing else
        produces it. Everything else reads as flat -- including the case where every block has one
        controlling value and every value appears once, which the two shapes render identically, so
        the answer cannot be observed there and either is correct.
    */
    static resolveValueSettingsShape(blocks: IPicklistDependencyValueSettingsBlock[]): PicklistDependencyValueSettingsShape {

        if ( blocks.some(block => block.controllingValues.length > 1) ) {
            return 'grouped';
        }

        return 'flat';

    }

    /*
        The contiguous run of blocks, plus the indentation they are written at.

        Contiguity is required rather than assumed: replacing a span that had unrelated markup
        interleaved between blocks would delete it. Salesforce never emits them that way, so the
        guard costs nothing and refuses rather than damages the one file that is unusual.
    */
    static resolveValueSettingsRegion(fieldFileContent: string): IPicklistDependencyValueSettingsRegion | undefined {

        const blocks = this.collectValueSettingsBlocks(fieldFileContent);

        if ( blocks.length === 0 ) {
            return undefined;
        }

        const indentation = this.resolveIndentationAtIndex(fieldFileContent, blocks[0].startIndex);

        /*
            The span starts at the beginning of the first block's LINE, not at its "<".

            Emission writes each block with its own indentation, so a span starting at the tag would
            leave the original indentation in front of the replacement and double it. Taking the
            whitespace into the span makes the replacement responsible for the whole line, which is
            also what lets an emptied region remove its line rather than leave it blank.
        */
        const startIndex = blocks[0].startIndex - indentation.length;
        const endIndex = blocks[blocks.length - 1].endIndex;

        for ( let blockIndex = 0; blockIndex < blocks.length - 1; blockIndex++ ) {

            const betweenBlocks = fieldFileContent.slice(blocks[blockIndex].endIndex, blocks[blockIndex + 1].startIndex);

            if ( betweenBlocks.trim() !== '' ) {
                return undefined;
            }

        }

        return {
            blocks,
            shape: this.resolveValueSettingsShape(blocks),
            startIndex,
            endIndex,
            indentation,
            lineEnding: this.resolveLineEnding(fieldFileContent)
        };

    }

    /*
        CRLF only when the file is consistently CRLF. A file with even one lone LF is treated as LF,
        because emitting CRLF into it would introduce the mixed endings this is here to prevent.
    */
    static resolveLineEnding(fieldFileContent: string): string {

        const lineFeedCount = ( fieldFileContent.match(/\n/g) || [] ).length;
        const carriageReturnLineFeedCount = ( fieldFileContent.match(/\r\n/g) || [] ).length;

        return lineFeedCount > 0 && lineFeedCount === carriageReturnLineFeedCount ? '\r\n' : '\n';

    }

    static resolveIndentationAtIndex(fieldFileContent: string, index: number): string {

        const lineStartIndex = fieldFileContent.lastIndexOf('\n', index - 1) + 1;
        const leadingText = fieldFileContent.slice(lineStartIndex, index);

        return /^[ \t]*$/.test(leadingText) ? leadingText : '        ';

    }

    /*
        The transpose. A spec is indexed by CONTROLLING value -- "cle unlocks plant" -- and
        valueSettings are indexed by DEPENDENT value -- "plant is unlocked by cle". Getting this
        backwards is the mistake the command exists to stop a human making by hand, so it is one
        function with one direction.

        An unavailable controlling value contributes nothing: it is a record-type scoped assertion
        about reachability, not a statement about what the field declares.
    */
    static buildControllingValuesByDependentValue(specDetail: IPicklistDependencySpecDetail): Record<string, string[]> {

        // NULL PROTOTYPED: THE KEYS ARE PICKLIST VALUES, AND "toString" AS A KEY OTHERWISE RETURNS A FUNCTION
        let controllingValuesByDependentValue: Record<string, string[]> = Object.create(null);

        specDetail.expectations.forEach(expectation => {

            if ( expectation.controllingValueUnavailable ) {
                return;
            }

            expectation.dependentValues.forEach(dependentValue => {

                controllingValuesByDependentValue[dependentValue] = controllingValuesByDependentValue[dependentValue] || [];

                if ( !controllingValuesByDependentValue[dependentValue].includes(expectation.controllingValue) ) {
                    controllingValuesByDependentValue[dependentValue].push(expectation.controllingValue);
                }

            });

        });

        return controllingValuesByDependentValue;

    }

    static buildControllingValuesByDependentValueFromBlocks(blocks: IPicklistDependencyValueSettingsBlock[]): Record<string, string[]> {

        let controllingValuesByDependentValue: Record<string, string[]> = Object.create(null);

        blocks.forEach(block => {

            controllingValuesByDependentValue[block.valueName] = controllingValuesByDependentValue[block.valueName] || [];

            block.controllingValues.forEach(controllingValue => {

                if ( !controllingValuesByDependentValue[block.valueName].includes(controllingValue) ) {
                    controllingValuesByDependentValue[block.valueName].push(controllingValue);
                }

            });

        });

        return controllingValuesByDependentValue;

    }

    /*
        Ordering is alphabetical on both axes, and is what makes a second writeback a no-op.

        Real files do not arrive sorted -- a fixture in this repository runs tree, weed, mulch,
        rocks, plant, matching neither declaration nor alphabetical order -- so the first
        reconciliation of a file reorders it once. Every one after that rewrites the same bytes,
        which is the property that keeps these files reviewable as diffs.
    */
    static compareForEmission(firstValue: string, secondValue: string): number {
        return firstValue < secondValue ? -1 : ( firstValue > secondValue ? 1 : 0 );
    }

    static buildValueSettingsMarkup(controllingValuesByDependentValue: Record<string, string[]>,
                                        shape: PicklistDependencyValueSettingsShape,
                                        indentation: string,
                                        lineEnding: string = '\n'): string {

        const childIndentation = `${indentation}    `;

        const dependentValues = Object.keys(controllingValuesByDependentValue)
            .filter(dependentValue => controllingValuesByDependentValue[dependentValue].length > 0)
            .sort((firstValue, secondValue) => this.compareForEmission(firstValue, secondValue));

        let blockMarkups: string[] = [];

        dependentValues.forEach(dependentValue => {

            const controllingValues = [...controllingValuesByDependentValue[dependentValue]]
                .sort((firstValue, secondValue) => this.compareForEmission(firstValue, secondValue));

            const buildBlock = (blockControllingValues: string[]) => {

                const controllingValueLines = blockControllingValues
                    .map(controllingValue => `${childIndentation}<controllingFieldValue>${this.encodeXmlText(controllingValue)}</controllingFieldValue>`)
                    .join(lineEnding);

                return `${indentation}<valueSettings>${lineEnding}${controllingValueLines}${lineEnding}${childIndentation}<valueName>${this.encodeXmlText(dependentValue)}</valueName>${lineEnding}${indentation}</valueSettings>`;

            };

            if ( shape === 'grouped' ) {
                blockMarkups.push(buildBlock(controllingValues));
                return;
            }

            controllingValues.forEach(controllingValue => blockMarkups.push(buildBlock([controllingValue])));

        });

        return blockMarkups.join(lineEnding);

    }

    /*
        What the valueSettings should say once the spec's intent is applied to what is already there.

        Merged rather than replaced, and this is the load-bearing semantic choice in the whole
        command. A spec asserts two things per controlling value: expectAtLeast names what it MUST
        unlock, and expectNotAllowed names what it must NOT. Anything it names neither way it makes
        no claim about -- and a controlling value the spec never mentions at all it makes no claim
        about either.

        Replacing the map wholesale would read every one of those silences as "remove it", so a
        hand written spec carrying a single expectAtLeast line would strip every other combination
        in the file. Writeback exists to apply an intent, not to narrow the metadata to whatever the
        spec happened to spell out.
    */
    static buildDesiredControllingValuesByDependentValue(specDetail: IPicklistDependencySpecDetail,
                                                            currentControllingValuesByDependentValue: Record<string, string[]>): Record<string, string[]> {

        let desiredControllingValueSets: Record<string, Set<string>> = Object.create(null);

        Object.keys(currentControllingValuesByDependentValue).forEach(dependentValue => {
            desiredControllingValueSets[dependentValue] = new Set(currentControllingValuesByDependentValue[dependentValue]);
        });

        const resolveControllingValueSet = (dependentValue: string): Set<string> => {

            if ( !desiredControllingValueSets[dependentValue] ) {
                desiredControllingValueSets[dependentValue] = new Set<string>();
            }

            return desiredControllingValueSets[dependentValue];

        };

        specDetail.expectations.forEach(expectation => {

            /*
                An unavailable controlling value is a record type scoped statement about
                reachability, not about what the field declares, so it changes nothing here.
            */
            if ( expectation.controllingValueUnavailable ) {
                return;
            }

            expectation.dependentValues.forEach(dependentValue => resolveControllingValueSet(dependentValue).add(expectation.controllingValue));

            ( expectation.forbiddenValues || [] ).forEach(dependentValue => {

                if ( desiredControllingValueSets[dependentValue] ) {
                    desiredControllingValueSets[dependentValue].delete(expectation.controllingValue);
                }

            });

            /*
                An EXHAUSTIVE list is the only thing that removes what the spec did not name.

                expectNone and expectExactly both state their dependent list completely, so anything
                else the metadata unlocks under this controlling value contradicts the spec and has
                to go. Everything else -- expectAtLeast, and any controlling value the spec never
                mentions -- is a floor rather than a complete list, and leaves the rest alone. Without
                this branch expectNone removes nothing at all, which makes the strictly stronger
                claim the one that does nothing.
            */
            if ( !expectation.dependentValuesAreExhaustive ) {
                return;
            }

            const exhaustiveDependentValues = new Set(expectation.dependentValues);

            Object.keys(desiredControllingValueSets).forEach(dependentValue => {

                if ( exhaustiveDependentValues.has(dependentValue) ) {
                    return;
                }

                desiredControllingValueSets[dependentValue].delete(expectation.controllingValue);

            });

        });

        let desiredControllingValuesByDependentValue: Record<string, string[]> = Object.create(null);

        Object.keys(desiredControllingValueSets).forEach(dependentValue => {
            desiredControllingValuesByDependentValue[dependentValue] = Array.from(desiredControllingValueSets[dependentValue]);
        });

        return desiredControllingValuesByDependentValue;

    }

    /*
        The pairs that changed, phrased the way the failure message that sent the user here is:
        "cle unlocks plant". A block-level diff would be accurate and unreadable.
    */
    static buildChangedPairSummaries(currentControllingValuesByDependentValue: Record<string, string[]>,
                                        desiredControllingValuesByDependentValue: Record<string, string[]>): { addedPairs: string[]; removedPairs: string[] } {

        let addedPairs: string[] = [];
        let removedPairs: string[] = [];

        const allDependentValues = Array.from(new Set([
            ...Object.keys(currentControllingValuesByDependentValue),
            ...Object.keys(desiredControllingValuesByDependentValue)
        ])).sort((firstValue, secondValue) => this.compareForEmission(firstValue, secondValue));

        allDependentValues.forEach(dependentValue => {

            const currentControllingValues = currentControllingValuesByDependentValue[dependentValue] || [];
            const desiredControllingValues = desiredControllingValuesByDependentValue[dependentValue] || [];

            // SETS RATHER THAN includes: BOTH LISTS CAN BE HUNDREDS LONG ON A LARGE PICKLIST
            const currentControllingValueSet = new Set(currentControllingValues);
            const desiredControllingValueSet = new Set(desiredControllingValues);

            desiredControllingValues
                .filter(controllingValue => !currentControllingValueSet.has(controllingValue))
                .sort((firstValue, secondValue) => this.compareForEmission(firstValue, secondValue))
                .forEach(controllingValue => addedPairs.push(`${controllingValue} unlocks ${dependentValue}`));

            currentControllingValues
                .filter(controllingValue => !desiredControllingValueSet.has(controllingValue))
                .sort((firstValue, secondValue) => this.compareForEmission(firstValue, secondValue))
                .forEach(controllingValue => removedPairs.push(`${controllingValue} no longer unlocks ${dependentValue}`));

        });

        return { addedPairs, removedPairs };

    }

    /*
        Dependent values this writeback would stop unlocking entirely, per field.

        A value that no controlling value unlocks any more is unreachable. That is fine in itself --
        it is what expectNone asks for -- but it matters when the value is ALSO the controlling field
        of another dependent picklist, because every valueSettings entry downstream that names it
        becomes unreachable too, and the org ends up with combinations nothing can select.
    */
    static collectOrphanedDependentValues(currentControllingValuesByDependentValue: Record<string, string[]>,
                                            desiredControllingValuesByDependentValue: Record<string, string[]>): string[] {

        return Object.keys(currentControllingValuesByDependentValue)
            .filter(dependentValue => currentControllingValuesByDependentValue[dependentValue].length > 0)
            .filter(dependentValue => ( desiredControllingValuesByDependentValue[dependentValue] || [] ).length === 0)
            .sort((firstValue, secondValue) => this.compareForEmission(firstValue, secondValue));

    }

    /*
        The fields downstream of one field, keyed by the value each of them is controlled through.

        Built from the spec details the whole run is reconciling, so the cascade check needs no
        second read of the metadata: a field whose controllingFieldApiName is this field is, by
        definition, the thing that breaks when a value here stops being selectable.
    */
    static buildDownstreamFieldApiNamesByControllingField(specDetails: IPicklistDependencySpecDetail[]): Record<string, string[]> {

        let downstreamFieldApiNamesByControllingField: Record<string, string[]> = Object.create(null);

        specDetails.forEach(specDetail => {

            const controllingFieldApiName = specDetail.controllingFieldApiName;

            downstreamFieldApiNamesByControllingField[controllingFieldApiName] =
                downstreamFieldApiNamesByControllingField[controllingFieldApiName] || [];

            if ( !downstreamFieldApiNamesByControllingField[controllingFieldApiName].includes(specDetail.fieldApiName) ) {
                downstreamFieldApiNamesByControllingField[controllingFieldApiName].push(specDetail.fieldApiName);
            }

        });

        return downstreamFieldApiNamesByControllingField;

    }

    /*
        Whether the dependent field takes its values from a GLOBAL value set."""

        Such a field has no local valueSetDefinition to add a value to -- the values live in a
        .globalValueSet-meta.xml shared across every object that uses it. Rewiring which controlling
        values unlock an existing value is safe and stays in this file; introducing a NEW value is
        not, because the only place to add it is the shared set, whose blast radius reaches every
        other field pointing at it.
    */
    static isGlobalValueSetBacked(fieldFileContent: string): boolean {
        return /<valueSetName>[\s\S]*?<\/valueSetName>/.test(fieldFileContent);
    }

    static resolveGlobalValueSetName(fieldFileContent: string): string {

        const valueSetNameMatch = /<valueSetName>([\s\S]*?)<\/valueSetName>/.exec(fieldFileContent);

        return valueSetNameMatch ? this.decodeXmlText(valueSetNameMatch[1]).trim() : '';

    }

    /*
        Every value the field's own valueSetDefinition declares.

        Read so writeback can tell a value it must ADD to the definition from one already there --
        a spec naming a value the field does not declare is exactly the case where the metadata is
        incomplete rather than merely mis-wired.
    */
    static collectDeclaredPicklistValues(fieldFileContent: string): string[] {

        const definitionMatch = /<valueSetDefinition>([\s\S]*?)<\/valueSetDefinition>/.exec(this.blankXmlComments(fieldFileContent));

        if ( !definitionMatch ) {
            return [];
        }

        let declaredValues: string[] = [];
        const fullNamePattern = /<fullName>([\s\S]*?)<\/fullName>/g;
        let fullNameMatch: RegExpExecArray | null;

        while ( ( fullNameMatch = fullNamePattern.exec(definitionMatch[1]) ) !== null ) {
            declaredValues.push(this.decodeXmlText(fullNameMatch[1]));
        }

        return declaredValues;

    }

    /*
        What writeback would do to one field file, or why it will not touch it.

        Nothing is written here. The plan carries the proposed content so the command can show what
        would change and let the user decline -- the same shape the generate command already uses,
        for the same reason: a developer's source metadata is not something to rewrite behind them.
    */
    static buildFieldWritebackOutcome(specDetail: IPicklistDependencySpecDetail,
                                        fieldFilePath: string,
                                        currentContent: string,
                                        downstreamFieldApiNames: string[] = []): IPicklistDependencyFieldWritebackOutcome {

        const buildRefusal = (reason: string): IPicklistDependencyFieldWritebackOutcome => ({
            refusal: { objectApiName: specDetail.objectApiName, fieldApiName: specDetail.fieldApiName, reason }
        });

        const region = this.resolveValueSettingsRegion(currentContent);

        if ( !region ) {
            return buildRefusal(
                `"${fieldFilePath}" has no readable "valueSettings" markup to reconcile -- either the field declares none, or unrelated markup sits between the blocks and a safe edit could not be identified. Nothing was written.`
            );
        }

        const currentControllingValuesByDependentValue = this.buildControllingValuesByDependentValueFromBlocks(region.blocks);
        const desiredControllingValuesByDependentValue = this.buildDesiredControllingValuesByDependentValue(
            specDetail, currentControllingValuesByDependentValue
        );

        const { addedPairs, removedPairs } = this.buildChangedPairSummaries(
            currentControllingValuesByDependentValue, desiredControllingValuesByDependentValue
        );

        /*
            Values the spec unlocks that the field has no way to offer yet.

            Known values are the local valueSetDefinition PLUS everything the file's own
            valueSettings already name. The union matters for a global-value-set-backed field: it
            has no local definition to read, so the definition alone reports every value as new --
            including ones already wired up. A value the file already references must exist in the
            global set, because metadata naming a value the set does not declare would not deploy.
        */
        const knownPicklistValues = new Set([
            ...this.collectDeclaredPicklistValues(currentContent),
            ...region.blocks.map(block => block.valueName)
        ]);

        const addedPicklistValues = Object.keys(desiredControllingValuesByDependentValue)
            .filter(dependentValue => desiredControllingValuesByDependentValue[dependentValue].length > 0)
            .filter(dependentValue => !knownPicklistValues.has(dependentValue))
            .sort((firstValue, secondValue) => this.compareForEmission(firstValue, secondValue));

        /*
            Reported and skipped rather than written, and the field's own write is abandoned with it.

            Writing the field would leave every downstream valueSettings entry naming the orphaned
            value pointing at something unselectable -- metadata that deploys but describes
            combinations no user can reach. Resolving that means editing the downstream field too,
            which is a decision about intent this command has no basis to make on its own, so it
            names the cascade and leaves both files alone. Every OTHER field in the run still writes.
        */
        const orphanedDependentValues = this.collectOrphanedDependentValues(
            currentControllingValuesByDependentValue, desiredControllingValuesByDependentValue
        );

        if ( orphanedDependentValues.length > 0 && downstreamFieldApiNames.length > 0 ) {

            return buildRefusal(
                `"${specDetail.objectApiName}.${specDetail.fieldApiName}" would stop unlocking ${orphanedDependentValues.map(value => `"${value}"`).join(', ')} entirely, and ${downstreamFieldApiNames.map(fieldApiName => `"${fieldApiName}"`).join(', ')} ${downstreamFieldApiNames.length === 1 ? 'is controlled' : 'are controlled'} by this field -- their entries for ${orphanedDependentValues.length === 1 ? 'that value' : 'those values'} would become unreachable. Nothing was written for this field. Reconcile the downstream field first, or keep the value unlocked.`
            );

        }

        if ( this.isGlobalValueSetBacked(currentContent) && addedPicklistValues.length > 0 ) {

            const globalValueSetName = this.resolveGlobalValueSetName(currentContent);

            /*
                Rewiring a global-value-set-backed field is fine and stays in this file. Adding a
                value is refused rather than attempted, because the only place it could go is the
                shared .globalValueSet-meta.xml, and editing that changes every other field pointing
                at the same set -- a blast radius the user did not ask for and cannot see from here.
            */
            return buildRefusal(
                `"${specDetail.objectApiName}.${specDetail.fieldApiName}" takes its values from the global value set "${globalValueSetName}", which this command never edits. Add ${addedPicklistValues.map(value => `"${value}"`).join(', ')} to that global value set first, then run this again to wire it up. The field's existing values can be rewired without this.`
            );

        }

        const proposedContent = this.buildProposedContent(
            currentContent, region, desiredControllingValuesByDependentValue, addedPicklistValues
        );

        return {
            plan: {
                objectApiName: specDetail.objectApiName,
                fieldApiName: specDetail.fieldApiName,
                fieldFilePath,
                proposedContent,
                hasChanges: proposedContent !== currentContent,
                addedPairs,
                removedPairs,
                addedPicklistValues
            }
        };

    }

    /*
        The file as it would be written: the valueSettings region replaced, and any value the spec
        names that the field does not declare added to valueSetDefinition.

        Only those two spans are touched. Everything else -- the xml declaration, indentation,
        unrelated markup, the presence or absence of a trailing newline -- is carried through
        untouched by construction, because it is never rebuilt.

        The definition is edited FIRST so the region indexes, which were resolved against the
        original string, are still valid when the region is spliced.
    */
    static buildProposedContent(currentContent: string,
                                    region: IPicklistDependencyValueSettingsRegion,
                                    desiredControllingValuesByDependentValue: Record<string, string[]>,
                                    addedPicklistValues: string[]): string {

        const valueSettingsMarkup = this.buildValueSettingsMarkup(
            desiredControllingValuesByDependentValue, region.shape, region.indentation, region.lineEnding
        );

        /*
            An emptied region takes its trailing line ending with it. The span already covers the
            whole line, so leaving the newline behind would leave a blank line where the blocks were.
        */
        const followsRegionIndex = valueSettingsMarkup === '' && currentContent.startsWith(region.lineEnding, region.endIndex)
            ? region.endIndex + region.lineEnding.length
            : region.endIndex;

        const proposedContent = currentContent.slice(0, region.startIndex)
                                + valueSettingsMarkup
                                + currentContent.slice(followsRegionIndex);

        if ( addedPicklistValues.length === 0 ) {
            return proposedContent;
        }

        return this.addPicklistValuesToDefinition(proposedContent, addedPicklistValues, region.indentation, region.lineEnding);

    }

    /*
        New values appended to valueSetDefinition, in the shape the file already uses.

        Appended rather than inserted alphabetically: valueSetDefinition order is what a picklist
        shows a user, and reordering it silently would change the org's UI as a side effect of
        wiring up a dependency.
    */
    static addPicklistValuesToDefinition(fieldFileContent: string,
                                            addedPicklistValues: string[],
                                            indentation: string,
                                            lineEnding: string): string {

        const definitionCloseTag = '</valueSetDefinition>';
        const definitionCloseIndex = fieldFileContent.lastIndexOf(definitionCloseTag);

        if ( definitionCloseIndex === -1 ) {
            return fieldFileContent;
        }

        const valueIndentation = `${indentation}    `;
        const valueChildIndentation = `${valueIndentation}    `;

        const addedValueMarkup = addedPicklistValues.map(addedPicklistValue => {

            const encodedValue = this.encodeXmlText(addedPicklistValue);

            return `${valueIndentation}<value>${lineEnding}`
                    + `${valueChildIndentation}<fullName>${encodedValue}</fullName>${lineEnding}`
                    + `${valueChildIndentation}<default>false</default>${lineEnding}`
                    + `${valueChildIndentation}<label>${encodedValue}</label>${lineEnding}`
                    + `${valueIndentation}</value>${lineEnding}`;

        }).join('');

        const definitionLineStartIndex = fieldFileContent.lastIndexOf(lineEnding, definitionCloseIndex - 1) + lineEnding.length;

        return fieldFileContent.slice(0, definitionLineStartIndex)
                + addedValueMarkup
                + fieldFileContent.slice(definitionLineStartIndex);

    }

    /*
        Decoded for the five named entities AND for numeric character references.

        Numeric references have to be decoded because the encoder below re-escapes every bare "&".
        Skipping them on the way in while escaping them on the way out is not conservative, it is
        lossy: "&#39;" is well formed XML for an apostrophe, so a value Salesforce stores as "Bob's"
        would be read as the literal text "&#39;" and written back as "&amp;#39;", which parses as
        seven characters and changes the value on deploy. Refusing to decode a form is only safe if
        you also refuse to re-encode it, and the encoder cannot tell an escape from data.

        The "&amp;" replacement runs LAST so an already-escaped entity is not decoded twice --
        "&amp;lt;" is the text "&lt;", not "<".
    */
    static decodeXmlText(value: string): string {

        return value
            .replace(/&#[xX]([0-9a-fA-F]+);/g, (wholeReference, hexadecimalCodePoint) =>
                this.decodeCharacterReference(wholeReference, parseInt(hexadecimalCodePoint, 16)))
            .replace(/&#([0-9]+);/g, (wholeReference, decimalCodePoint) =>
                this.decodeCharacterReference(wholeReference, parseInt(decimalCodePoint, 10)))
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, `'`)
            .replace(/&amp;/g, '&');

    }

    /*
        A reference outside what a code point can represent is left exactly as written rather than
        turned into a replacement character: it is not something Salesforce emits, and silently
        substituting a different character is the corruption this decoder exists to avoid.
    */
    static decodeCharacterReference(wholeReference: string, codePoint: number): string {

        if ( !Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10FFFF ) {
            return wholeReference;
        }

        try {
            return String.fromCodePoint(codePoint);
        } catch {
            return wholeReference;
        }

    }

    /*
        Escaped for ELEMENT TEXT CONTENT only, which is the one context these values are emitted in.

        XML requires escaping just "<" and "&" in character data; ">" is escaped too because it is
        required inside the "]]>" sequence and unconditional is simpler than conditional. Quotes are
        deliberately NOT escaped -- they only need it inside an attribute value, and a picklist value
        never lands in one here.

        That contract is the reason this is safe. Interpolating the output of this function into an
        attribute would make it an injection primitive, so if a caller ever needs that, it needs a
        different function rather than an extra replacement bolted onto this one.

        The "&" replacement runs FIRST so the escapes this function itself produces are not escaped
        a second time.
    */
    static encodeXmlText(value: string): string {

        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

    }

}
