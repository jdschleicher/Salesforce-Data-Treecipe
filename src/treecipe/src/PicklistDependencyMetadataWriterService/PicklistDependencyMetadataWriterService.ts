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
    currentContent: string;
    proposedContent: string;
    hasChanges: boolean;
    // PAIRS AS THE READER THINKS OF THEM -- "cle unlocks plant" -- RATHER THAN AS BLOCKS
    addedPairs: string[];
    removedPairs: string[];
    addedPicklistValues: string[];
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

        const blockPattern = /<valueSettings>([\s\S]*?)<\/valueSettings>/g;
        let blockMatch: RegExpExecArray | null;

        while ( ( blockMatch = blockPattern.exec(fieldFileContent) ) !== null ) {

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

        const startIndex = blocks[0].startIndex;
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
            indentation: this.resolveIndentationAtIndex(fieldFileContent, startIndex)
        };

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

        let controllingValuesByDependentValue: Record<string, string[]> = {};

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

        let controllingValuesByDependentValue: Record<string, string[]> = {};

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
                                        indentation: string): string {

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
                    .join('\n');

                return `${indentation}<valueSettings>\n${controllingValueLines}\n${childIndentation}<valueName>${this.encodeXmlText(dependentValue)}</valueName>\n${indentation}</valueSettings>`;

            };

            if ( shape === 'grouped' ) {
                blockMarkups.push(buildBlock(controllingValues));
                return;
            }

            controllingValues.forEach(controllingValue => blockMarkups.push(buildBlock([controllingValue])));

        });

        return blockMarkups.join('\n');

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

        let desiredControllingValuesByDependentValue: Record<string, string[]> = {};

        Object.keys(currentControllingValuesByDependentValue).forEach(dependentValue => {
            desiredControllingValuesByDependentValue[dependentValue] = [...currentControllingValuesByDependentValue[dependentValue]];
        });

        specDetail.expectations.forEach(expectation => {

            /*
                An unavailable controlling value is a record type scoped statement about
                reachability, not about what the field declares, so it changes nothing here.
            */
            if ( expectation.controllingValueUnavailable ) {
                return;
            }

            expectation.dependentValues.forEach(dependentValue => {

                desiredControllingValuesByDependentValue[dependentValue] = desiredControllingValuesByDependentValue[dependentValue] || [];

                if ( !desiredControllingValuesByDependentValue[dependentValue].includes(expectation.controllingValue) ) {
                    desiredControllingValuesByDependentValue[dependentValue].push(expectation.controllingValue);
                }

            });

            ( expectation.forbiddenValues || [] ).forEach(dependentValue => {

                if ( !desiredControllingValuesByDependentValue[dependentValue] ) {
                    return;
                }

                desiredControllingValuesByDependentValue[dependentValue] = desiredControllingValuesByDependentValue[dependentValue]
                    .filter(controllingValue => controllingValue !== expectation.controllingValue);

            });

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

            desiredControllingValues
                .filter(controllingValue => !currentControllingValues.includes(controllingValue))
                .sort((firstValue, secondValue) => this.compareForEmission(firstValue, secondValue))
                .forEach(controllingValue => addedPairs.push(`${controllingValue} unlocks ${dependentValue}`));

            currentControllingValues
                .filter(controllingValue => !desiredControllingValues.includes(controllingValue))
                .sort((firstValue, secondValue) => this.compareForEmission(firstValue, secondValue))
                .forEach(controllingValue => removedPairs.push(`${controllingValue} no longer unlocks ${dependentValue}`));

        });

        return { addedPairs, removedPairs };

    }

    /*
        Decoded and encoded only for the five entities XML defines.

        Deliberately not a general entity decoder: a picklist value is text Salesforce round trips,
        and inventing decodings for numeric or named entities it never emits would change values on
        the way through.
    */
    static decodeXmlText(value: string): string {

        return value
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, `'`)
            .replace(/&amp;/g, '&');

    }

    static encodeXmlText(value: string): string {

        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

    }

}
