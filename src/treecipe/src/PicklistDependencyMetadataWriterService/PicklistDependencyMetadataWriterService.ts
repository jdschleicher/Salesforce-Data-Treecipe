import { IPicklistDependencySpecDetail } from '../PicklistDependencyTestService/PicklistDependencyTestService';

import * as fs from 'fs';
import * as path from 'path';

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

export interface IPicklistDependencyWritebackResult {
    plans: IPicklistDependencyFieldWritebackPlan[];
    refusals: IPicklistDependencyWritebackRefusal[];
    /*
        Fields whose Apex and metadata already agree, so the command can say "already in sync"
        honestly. Object-qualified like every other name the report prints, because a run spans
        objects and a bare field api name does not say which one is in sync.
    */
    unchangedFieldKeys: string[];
}

export class PicklistDependencyMetadataWriterService {

    /*
        The identity of one field across a run: object AND field, never field alone.

        A run reconciles the spec details of every per-object class at once, and field api names are
        not unique across objects -- "Status__c" on Account and on Case are routine and different.
        Keying anything by the bare field api name collides them, which is how one object's
        dependency metadata ends up written into another object's file. One function so the map and
        every lookup against it are built the same way.
    */
    static buildFieldKey(objectApiName: string, fieldApiName: string): string {
        return `${objectApiName}.${fieldApiName}`;
    }

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
            The span starts at the beginning of the first block's LINE, not at its "<" -- but only
            when that line holds nothing but whitespace before the tag.

            Emission writes each block with its own indentation, so a span starting at the tag would
            leave the original indentation in front of the replacement and double it. Taking the
            whitespace into the span makes the replacement responsible for the whole line, which is
            also what lets an emptied region remove its line rather than leave it blank.

            When the first block does NOT start its own line -- "<valueSet><valueSettings>" in a file
            that is not pretty printed -- the span is clamped to the tag. Extending it back over
            real markup would splice out characters that have nothing to do with valueSettings, and
            since resolveIndentationAtIndex falls back to a fixed width in exactly that case, the
            number of characters removed would be arbitrary. Well formed output that indents oddly
            beats a file that no longer parses.
        */
        const lineStartIndex = fieldFileContent.lastIndexOf('\n', blocks[0].startIndex - 1) + 1;
        const firstBlockOwnsItsLine = /^[ \t]*$/.test(fieldFileContent.slice(lineStartIndex, blocks[0].startIndex));

        const startIndex = firstBlockOwnsItsLine ? lineStartIndex : blocks[0].startIndex;
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
        The fields downstream of one field, keyed by the field key of the field controlling them.

        Built from the spec details the whole run is reconciling, so the cascade check needs no
        second read of the metadata: a field whose controllingFieldApiName is this field is, by
        definition, the thing that breaks when a value here stops being selectable.

        Keyed by OBJECT AND controlling field. A controlling field always lives on the same object as
        the field it controls, so scoping the key to that object is what the relationship already
        means -- and without it "Account.Type__c" would be read as controlling "Case.Sub_Type__c" and
        refuse an unrelated object's write for a cascade that does not exist.
    */
    static buildDownstreamFieldApiNamesByControllingField(specDetails: IPicklistDependencySpecDetail[]): Record<string, string[]> {

        let downstreamFieldApiNamesByControllingField: Record<string, string[]> = Object.create(null);

        specDetails.forEach(specDetail => {

            const controllingFieldKey = this.buildFieldKey(specDetail.objectApiName, specDetail.controllingFieldApiName);

            downstreamFieldApiNamesByControllingField[controllingFieldKey] =
                downstreamFieldApiNamesByControllingField[controllingFieldKey] || [];

            if ( !downstreamFieldApiNamesByControllingField[controllingFieldKey].includes(specDetail.fieldApiName) ) {
                downstreamFieldApiNamesByControllingField[controllingFieldKey].push(specDetail.fieldApiName);
            }

        });

        return downstreamFieldApiNamesByControllingField;

    }

    /*
        Whether the dependent field takes its values from a GLOBAL value set.

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

        The region is spliced FIRST and the definition edited on the result, which is safe because
        addPicklistValuesToDefinition re-derives its own indexes from the string it is handed and
        carries none from the original -- so it is equally correct whether valueSetDefinition sits
        before or after the region.
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

        /*
            Located against the comment blanked copy, which preserves offsets, so a commented out
            "</valueSetDefinition>" later in the file cannot pull the insertion point into dead text
            -- where the values would be written but never parsed, while the report still claimed
            them.
        */
        const definitionCloseTag = '</valueSetDefinition>';
        const definitionCloseIndex = this.blankXmlComments(fieldFileContent).lastIndexOf(definitionCloseTag);

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

        const precedingLineEndingIndex = fieldFileContent.lastIndexOf(lineEnding, definitionCloseIndex - 1);
        const definitionLineStartIndex = precedingLineEndingIndex === -1 ? 0 : precedingLineEndingIndex + lineEnding.length;

        return fieldFileContent.slice(0, definitionLineStartIndex)
                + addedValueMarkup
                + fieldFileContent.slice(definitionLineStartIndex);

    }

    /*
        Every field of one object reconciled against the specs its generated class declares.

        The downstream map is built ONCE from the whole spec set rather than per field, because the
        orphaning cascade is a question about the object's dependency graph, not about the field in
        hand -- a field only orphans something if another field is controlled through it.

        A field whose file cannot be read is refused rather than skipped silently: writeback that
        quietly did nothing for a field the user asked it to fix would be worse than one that says
        it could not.
    */
    static buildWritebackResult(specDetails: IPicklistDependencySpecDetail[],
                                    fieldFilePathsByFieldKey: Record<string, string>,
                                    readFieldFileContent: (fieldFilePath: string) => string): IPicklistDependencyWritebackResult {

        const downstreamFieldApiNamesByControllingField = this.buildDownstreamFieldApiNamesByControllingField(specDetails);

        let plans: IPicklistDependencyFieldWritebackPlan[] = [];
        let refusals: IPicklistDependencyWritebackRefusal[] = [];
        let unchangedFieldKeys: string[] = [];

        specDetails.forEach(specDetail => {

            const fieldFilePath = fieldFilePathsByFieldKey[this.buildFieldKey(specDetail.objectApiName, specDetail.fieldApiName)];

            if ( !fieldFilePath ) {
                refusals.push({
                    objectApiName: specDetail.objectApiName,
                    fieldApiName: specDetail.fieldApiName,
                    reason: `No field metadata file was found for "${specDetail.objectApiName}.${specDetail.fieldApiName}". The Apex spec names a field this objects directory does not contain. Nothing was written for it.`
                });
                return;
            }

            let currentContent: string;

            try {
                currentContent = readFieldFileContent(fieldFilePath);
            } catch (error) {
                refusals.push({
                    objectApiName: specDetail.objectApiName,
                    fieldApiName: specDetail.fieldApiName,
                    reason: `"${fieldFilePath}" could not be read (${error.message}). Nothing was written for this field.`
                });
                return;
            }

            const outcome = this.buildFieldWritebackOutcome(
                specDetail,
                fieldFilePath,
                currentContent,
                downstreamFieldApiNamesByControllingField[this.buildFieldKey(specDetail.objectApiName, specDetail.fieldApiName)] || []
            );

            if ( outcome.refusal ) {
                refusals.push(outcome.refusal);
                return;
            }

            if ( !outcome.plan.hasChanges ) {
                unchangedFieldKeys.push(this.buildFieldKey(specDetail.objectApiName, specDetail.fieldApiName));
                return;
            }

            plans.push(outcome.plan);

        });

        /*
            A dependent field's valueSettings can only name a controlling value the CONTROLLING field
            actually offers. Wiring up "texas unlocks cle" while State__c declares no "texas" writes
            metadata describing a combination no user can reach, so the controlling side is
            reconciled in the same run rather than left for the developer to notice on deploy.
        */
        const controllingFieldOutcomes = this.buildControllingFieldValueOutcomes(
            specDetails, plans, fieldFilePathsByFieldKey, readFieldFileContent
        );

        return {
            plans: controllingFieldOutcomes.plans,
            refusals: refusals.concat(controllingFieldOutcomes.refusals),
            unchangedFieldKeys
        };

    }

    /*
        The values each controlling field must gain for the writes this run is about to make.

        Scoped to spec details that produced a PLAN, deliberately. A controlling value missing from
        the controlling field is only this command's business because it is about to write a
        valueSettings entry naming it -- reaching further would turn a targeted fix into an audit of
        metadata the run was never asked to touch.

        A controlling field that already has a plan of its own -- the chained case, where it is also
        somebody's dependent field -- has the values folded into THAT plan rather than given a second
        one, because two plans for one path would write the file twice and the second would win.
    */
    static buildControllingFieldValueOutcomes(specDetails: IPicklistDependencySpecDetail[],
                                                plans: IPicklistDependencyFieldWritebackPlan[],
                                                fieldFilePathsByFieldKey: Record<string, string>,
                                                readFieldFileContent: (fieldFilePath: string) => string):
                                                { plans: IPicklistDependencyFieldWritebackPlan[], refusals: IPicklistDependencyWritebackRefusal[] } {

        const plannedFieldKeys = new Set(plans.map(plan => this.buildFieldKey(plan.objectApiName, plan.fieldApiName)));

        let controllingValuesByControllingFieldKey: Record<string, string[]> = Object.create(null);
        let controllingFieldsByKey: Record<string, { objectApiName: string, fieldApiName: string }> = Object.create(null);

        specDetails.forEach(specDetail => {

            if ( !plannedFieldKeys.has(this.buildFieldKey(specDetail.objectApiName, specDetail.fieldApiName)) ) {
                return;
            }

            const controllingFieldKey = this.buildFieldKey(specDetail.objectApiName, specDetail.controllingFieldApiName);

            controllingValuesByControllingFieldKey[controllingFieldKey] =
                controllingValuesByControllingFieldKey[controllingFieldKey] || [];
            controllingFieldsByKey[controllingFieldKey] =
                { objectApiName: specDetail.objectApiName, fieldApiName: specDetail.controllingFieldApiName };

            specDetail.expectations.forEach(expectation => {

                /*
                    Only a value the spec asserts is USABLE names something the controlling field has
                    to offer. A forbidden combination asserts the opposite, so an expectNotAllowed on
                    a value the controlling field does not declare is already satisfied.
                */
                if ( expectation.dependentValues.length === 0 && !expectation.dependentValuesAreExhaustive ) {
                    return;
                }

                if ( !controllingValuesByControllingFieldKey[controllingFieldKey].includes(expectation.controllingValue) ) {
                    controllingValuesByControllingFieldKey[controllingFieldKey].push(expectation.controllingValue);
                }

            });

        });

        let resultingPlans = plans.slice();
        let refusals: IPicklistDependencyWritebackRefusal[] = [];

        Object.keys(controllingValuesByControllingFieldKey).forEach(controllingFieldKey => {

            const controllingField = controllingFieldsByKey[controllingFieldKey];
            const existingPlanIndex = resultingPlans.findIndex(plan =>
                this.buildFieldKey(plan.objectApiName, plan.fieldApiName) === controllingFieldKey);

            const controllingFieldFilePath = existingPlanIndex >= 0
                ? resultingPlans[existingPlanIndex].fieldFilePath
                : fieldFilePathsByFieldKey[controllingFieldKey];

            const buildRefusal = (reason: string) => refusals.push({
                objectApiName: controllingField.objectApiName,
                fieldApiName: controllingField.fieldApiName,
                reason
            });

            let baseContent: string;

            if ( existingPlanIndex >= 0 ) {
                baseContent = resultingPlans[existingPlanIndex].proposedContent;
            } else {

                if ( !controllingFieldFilePath ) {
                    /*
                        No file for the controlling field is not automatically a problem: it is how a
                        standard picklist, or one this objects directory does not carry, looks from
                        here. Reported only when a value is actually missing, which cannot be known
                        without the file, so silence is the honest answer.
                    */
                    return;
                }

                try {
                    baseContent = readFieldFileContent(controllingFieldFilePath);
                } catch (error) {
                    buildRefusal(`"${controllingFieldFilePath}" could not be read (${error.message}), so the controlling values the specs name could not be checked against it. Nothing was written for this field.`);
                    return;
                }

            }

            const declaredValues = new Set(this.collectDeclaredPicklistValues(baseContent));

            const addedPicklistValues = controllingValuesByControllingFieldKey[controllingFieldKey]
                .filter(controllingValue => !declaredValues.has(controllingValue))
                .sort((firstValue, secondValue) => this.compareForEmission(firstValue, secondValue));

            if ( addedPicklistValues.length === 0 ) {
                return;
            }

            if ( this.isGlobalValueSetBacked(baseContent) ) {
                buildRefusal(`"${controllingFieldKey}" controls a field this run is reconciling and takes its values from the global value set "${this.resolveGlobalValueSetName(baseContent)}", which this command never edits. Add ${addedPicklistValues.map(value => `"${value}"`).join(', ')} to that global value set first, then run this again.`);
                return;
            }

            const indentation = this.resolveValueSetDefinitionIndentation(baseContent);

            if ( indentation === undefined ) {
                buildRefusal(`"${controllingFieldKey}" has no "valueSetDefinition" markup, so ${addedPicklistValues.map(value => `"${value}"`).join(', ')} could not be added to it. Add ${addedPicklistValues.length === 1 ? 'it' : 'them'} to the controlling picklist first, then run this again.`);
                return;
            }

            const proposedContent = this.addPicklistValuesToDefinition(
                baseContent, addedPicklistValues, indentation, this.resolveLineEnding(baseContent)
            );

            if ( existingPlanIndex >= 0 ) {

                const existingPlan = resultingPlans[existingPlanIndex];

                resultingPlans[existingPlanIndex] = {
                    ...existingPlan,
                    proposedContent,
                    addedPicklistValues: existingPlan.addedPicklistValues.concat(addedPicklistValues)
                };

                return;

            }

            resultingPlans.push({
                objectApiName: controllingField.objectApiName,
                fieldApiName: controllingField.fieldApiName,
                fieldFilePath: controllingFieldFilePath,
                proposedContent,
                hasChanges: true,
                addedPairs: [],
                removedPairs: [],
                addedPicklistValues
            });

        });

        return { plans: resultingPlans, refusals };

    }

    /*
        The indentation of the field's valueSetDefinition element, or undefined when it has none.

        Undefined is the signal to refuse rather than to guess: a file with no valueSetDefinition has
        nowhere to put a new value, and appending one anyway is how a report claims an addition the
        written file does not contain.
    */
    static resolveValueSetDefinitionIndentation(fieldFileContent: string): string | undefined {

        const definitionOpenIndex = this.blankXmlComments(fieldFileContent).indexOf('<valueSetDefinition>');

        if ( definitionOpenIndex === -1 ) {
            return undefined;
        }

        return this.resolveIndentationAtIndex(fieldFileContent, definitionOpenIndex);

    }

    /*
        The only function in this service that touches disk.

        Kept apart from every planning function above so the whole decision -- what would change,
        what is refused, what is already in sync -- is computable and testable without a filesystem,
        and so a caller can show it and be declined before anything is written.
    */
    static writeFieldWritebackPlans(plans: IPicklistDependencyFieldWritebackPlan[],
                                        containingDirectoryPath?: string): string[] {

        return plans.map(plan => {

            /*
                The sink checks containment itself rather than trusting the api name validation two
                services upstream. That validation is what makes traversal impossible today, but a
                write sink whose safety lives in another file stops being safe the moment somebody
                adds a second caller -- and realpath additionally refuses a field file that is a
                symlink out of the tree, which a path check alone would follow.
            */
            if ( containingDirectoryPath ) {
                this.assertFieldFileContainedIn(plan.fieldFilePath, containingDirectoryPath);
            }

            fs.writeFileSync(plan.fieldFilePath, plan.proposedContent);
            return plan.fieldFilePath;

        });

    }

    static assertFieldFileContainedIn(fieldFilePath: string, containingDirectoryPath: string) {

        const resolvedContainingDirectoryPath = fs.realpathSync(containingDirectoryPath);
        const resolvedFieldFilePath = fs.realpathSync(fieldFilePath);

        if ( resolvedFieldFilePath !== resolvedContainingDirectoryPath
                && !resolvedFieldFilePath.startsWith(resolvedContainingDirectoryPath + path.sep) ) {
            throw new Error(`"${fieldFilePath}" resolves outside "${containingDirectoryPath}". Nothing was written. Field metadata is only ever written inside the configured Salesforce objects directory.`);
        }

    }

    /*
        What the run would do, in the words the failure that sent the user here used.

        Shown BEFORE anything is written, so a reader can decline. Pairs rather than blocks: "cle
        unlocks plant" is what the validator said, and echoing its vocabulary is what makes the
        change recognisable as the fix for the failure they are looking at.
    */
    static buildWritebackReport(result: IPicklistDependencyWritebackResult): string {

        let reportLines: string[] = [];

        result.plans.forEach(plan => {

            reportLines.push(`${plan.objectApiName}.${plan.fieldApiName}`);

            plan.addedPairs.forEach(addedPair => reportLines.push(`    + ${addedPair}`));
            plan.removedPairs.forEach(removedPair => reportLines.push(`    - ${removedPair}`));

            plan.addedPicklistValues.forEach(addedPicklistValue =>
                reportLines.push(`    + adds "${addedPicklistValue}" to the field's picklist values`));

        });

        if ( result.unchangedFieldKeys.length > 0 ) {
            reportLines.push(`Already in sync: ${result.unchangedFieldKeys.join(', ')}`);
        }

        result.refusals.forEach(refusal => reportLines.push(`Skipped ${refusal.objectApiName}.${refusal.fieldApiName}: ${refusal.reason}`));

        return reportLines.join('\n');

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
