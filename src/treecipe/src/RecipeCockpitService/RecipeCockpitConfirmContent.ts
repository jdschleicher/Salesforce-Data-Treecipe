/*
    What a Recipe Cockpit confirmation says (#457), in three parts: the SUMMARY and the WARNINGS are
    always on screen, and each SECTION is folded under its title until the reader opens it. The
    summary says what will happen and to which org (the badge, when there is one, is the org's
    type); a warning is anything with no undo or anything surprising; a section is the detail a
    reader checks only when they want to. Every string is the host's. An empty string in a list of
    lines is a gap. Its own file, importing nothing, so the vscode-free helpers that word a
    confirmation can build one without importing the cockpit.
*/
export interface IRecipeCockpitConfirmSection {
    title: string;
    lines: string[];
    count?: number;
}

export interface IRecipeCockpitConfirmContent {
    summary: string[];
    badge?: string;
    warnings?: string[];
    sections?: IRecipeCockpitConfirmSection[];
}

// WHAT IS POSTED: EVERY PART PRESENT, NO LINE HOLDING A LINE BREAK, NO EMPTY SECTION OR BLANK WARNING
export interface IRecipeCockpitConfirmRequestParts {
    summary: string[];
    badge?: string;
    warnings: string[];
    sections: IRecipeCockpitConfirmSection[];
}

export class RecipeCockpitConfirmContent {

    /*
        A line the host wrote with a line break is split into lines, so no part ever holds one; a
        section with no line left, or a warning that is blank, is not posted at all, so the panel
        never draws an empty fold or an empty callout. Gaps at either end of a part are dropped.
    */
    static buildRequestParts(confirmContent: IRecipeCockpitConfirmContent): IRecipeCockpitConfirmRequestParts {

        const sections = ( confirmContent.sections ?? [] )
            .map(section => ({ section: section, lines: this.trimGaps(this.splitLines(section.lines)) }))
            .filter(sectionLines => sectionLines.lines.length > 0)
            .map(sectionLines => ({
                title: sectionLines.section.title,
                lines: sectionLines.lines,
                ...( this.isCount(sectionLines.section.count) ? { count: sectionLines.section.count } : {} )
            }));

        return {
            summary: this.trimGaps(this.splitLines(confirmContent.summary)),
            ...( confirmContent.badge ? { badge: confirmContent.badge } : {} ),
            warnings: this.splitLines(confirmContent.warnings ?? []).filter(warning => warning.trim() !== ''),
            sections: sections
        };

    }

    /*
        The same parts as one text, in the order the dialog draws them: the summary, the warnings,
        then each section under its title. For the suites that script a confirmation through the
        mocked modal, which reads one detail string; the reader never sees it.
    */
    static flatten(confirmContent: IRecipeCockpitConfirmContent): string {

        const parts = this.buildRequestParts(confirmContent);

        return [
            ...parts.summary,
            ...parts.warnings,
            ...parts.sections.flatMap(section => ['', section.count !== undefined ? `${section.title} · ${section.count}` : section.title, ...section.lines])
        ].join('\n');

    }

    private static isCount(count: number | undefined): count is number {
        return count !== undefined && Number.isSafeInteger(count) && count >= 0;
    }

    private static splitLines(lines: readonly string[]): string[] {
        return lines.flatMap(line => line.split(/\r\n|\r|\n/));
    }

    private static trimGaps(lines: string[]): string[] {

        const isText = (line: string) => line.trim() !== '';
        const firstIndex = lines.findIndex(isText);

        if ( firstIndex === -1 ) {
            return [];
        }

        let lastIndex = lines.length - 1;
        while ( !isText(lines[lastIndex]) ) {
            lastIndex--;
        }

        return lines.slice(firstIndex, lastIndex + 1);

    }

}
