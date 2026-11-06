/*
    The unified diff the golden test (#571) and the Recipe Cockpit's rendered baselines (#580) print
    when a file differs from what was checked in: a test file imports this module rather than another
    test file, which would run that file's suites too.
*/

/*
    A unified diff of one file, three lines of context, line numbers from the expected file. The
    common head and tail are trimmed first, so the longest-common-subsequence table only spans the
    lines that changed.
*/
// 2,000 × 2,000 CHANGED LINES IS ABOUT 32 MB OF TABLE; TODAY'S LARGEST GOLDEN FILE IS 2,452 LINES
const MAXIMUM_ALIGNED_DIFF_CELLS = 4_000_000;

// WHAT THE TWO SIDES ARE CALLED IN THE HEADER: THE GOLDEN TEST'S BY DEFAULT, A COCKPIT BASELINE'S baselines/ AND rendered/
export function buildUnifiedDiff(goldenFileName: string, expectedText: string, actualText: string, sideLabels: { expected: string; actual: string } = { expected: 'golden', actual: 'generated' }): string {

    const expectedLines = expectedText.split('\n');
    const actualLines = actualText.split('\n');

    let headLength = 0;
    while ( headLength < expectedLines.length && headLength < actualLines.length && expectedLines[headLength] === actualLines[headLength] ) {
        headLength++;
    }
    let tailLength = 0;
    while ( tailLength < expectedLines.length - headLength && tailLength < actualLines.length - headLength
            && expectedLines[expectedLines.length - 1 - tailLength] === actualLines[actualLines.length - 1 - tailLength] ) {
        tailLength++;
    }

    const changedExpected = expectedLines.slice(headLength, expectedLines.length - tailLength);
    const changedActual = actualLines.slice(headLength, actualLines.length - tailLength);

    // THE TABLE IS changed × changed NUMBERS: A WHOLLY REWRITTEN LARGE FILE WOULD RUN THE WORKER OUT OF MEMORY, SO IT IS SHOWN AS ALL OUT, ALL IN
    const isTooLargeToAlign = changedExpected.length * changedActual.length > MAXIMUM_ALIGNED_DIFF_CELLS;
    const commonLengths = isTooLargeToAlign ? [] : Array.from({ length: changedExpected.length + 1 }, () => new Array<number>(changedActual.length + 1).fill(0));
    for ( let expectedIndex = commonLengths.length ? changedExpected.length - 1 : -1; expectedIndex >= 0; expectedIndex-- ) {
        for ( let actualIndex = changedActual.length - 1; actualIndex >= 0; actualIndex-- ) {
            commonLengths[expectedIndex][actualIndex] = changedExpected[expectedIndex] === changedActual[actualIndex]
                ? commonLengths[expectedIndex + 1][actualIndex + 1] + 1
                : Math.max(commonLengths[expectedIndex + 1][actualIndex], commonLengths[expectedIndex][actualIndex + 1]);
        }
    }

    const changeLines: string[] = isTooLargeToAlign
        ? [...changedExpected.map(removedLine => `-${removedLine}`), ...changedActual.map(addedLine => `+${addedLine}`)]
        : [];
    let expectedIndex = isTooLargeToAlign ? changedExpected.length : 0;
    let actualIndex = isTooLargeToAlign ? changedActual.length : 0;
    while ( expectedIndex < changedExpected.length || actualIndex < changedActual.length ) {
        if ( expectedIndex < changedExpected.length && actualIndex < changedActual.length && changedExpected[expectedIndex] === changedActual[actualIndex] ) {
            changeLines.push(` ${changedExpected[expectedIndex]}`);
            expectedIndex++;
            actualIndex++;
        } else if ( expectedIndex < changedExpected.length && ( actualIndex === changedActual.length || commonLengths[expectedIndex + 1][actualIndex] >= commonLengths[expectedIndex][actualIndex + 1] ) ) {
            changeLines.push(`-${changedExpected[expectedIndex]}`);
            expectedIndex++;
        } else {
            changeLines.push(`+${changedActual[actualIndex]}`);
            actualIndex++;
        }
    }

    const contextBefore = expectedLines.slice(Math.max(0, headLength - 3), headLength).map(contextLine => ` ${contextLine}`);
    const contextAfter = expectedLines.slice(expectedLines.length - tailLength, expectedLines.length - tailLength + 3).map(contextLine => ` ${contextLine}`);
    const firstLineNumber = headLength - contextBefore.length + 1;

    return [
        `--- ${sideLabels.expected}/${goldenFileName}`,
        `+++ ${sideLabels.actual}/${goldenFileName}`,
        `@@ line ${firstLineNumber} (first change at line ${headLength + 1}) @@`,
        ...contextBefore,
        ...changeLines,
        ...contextAfter
    ].join('\n');

}
