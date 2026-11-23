// TYPES ONLY: THE HUB IMPORTS THIS FILE'S TAB, AND A HOST NEVER LOADS THE HUB'S CODE
import type { IRecipeCockpitPanelState } from './RecipeCockpitViewModel';

/*
    A preview row's record link (#556; moved out of the hub by #668): the registry the Query and
    Adapter hosts post their previews through. Each preview names the held data it was drawn from by a
    token, so a record is opened only while that data is still held.
*/

/*
    A preview whose rows link their record (#556), as the host keeps it: the Ids by object ('' for
    the Query tab's one result) and row, the org they were read from, and a TOKEN for the held data
    they came from, which a click must still find held. A token and never the data itself, so a
    preview does not keep a released result, load or set of values in memory. The panel is sent only
    positions.
*/
export type RecipeCockpitRecordLinkPreviewKind = 'query' | 'updaterRecords' | 'updaterValues';

export interface IRecipeCockpitOpenableRecordPreview {
    previewKind: RecipeCockpitRecordLinkPreviewKind;
    recordLinkSequence: number;
    renderSequence: number;
    treeKey: string;
    orgUsername: string;
    heldSourceToken: number;
    recordIdsByObjectApiName: Map<string, (string | undefined)[]>;
}

export class RecipeCockpitRecordLinks {

    private static recordLinkSequence = 0;

    // HELD DATA → THE TOKEN ITS PREVIEW CARRIES: A WeakMap, SO A TOKEN NEVER KEEPS RELEASED DATA ALIVE
    private static readonly heldSourceTokens = new WeakMap<object, number>();

    private static heldSourceTokenSequence = 0;

    // undefined ONCE THE DATA IS LET GO OR REPLACED, WHICH IS WHY A ROW'S TOKEN IS CHECKED BEFORE IT IS OPENED
    static readHeldSourceToken(heldSource: object): number | undefined {
        return this.heldSourceTokens.get(heldSource);
    }

    /*
        Keeps a preview's record links PENDING (#556), replacing any earlier preview of its kind, and
        answers the sequence to post with it -- or undefined when no row links a record, so a preview
        with none posts exactly what it did.
    */
    static registerRecordLinkPreview(panelState: IRecipeCockpitPanelState,
                                     previewDetail: Omit<IRecipeCockpitOpenableRecordPreview, 'recordLinkSequence' | 'heldSourceToken'> & { heldSource: object }): number | undefined {

        [panelState.pendingOpenableRecordPreviews, panelState.openableRecordPreviews].forEach(previews => {
            [...previews.entries()].forEach(([recordLinkSequence, preview]) => {
                if ( preview.previewKind === previewDetail.previewKind ) {
                    previews.delete(recordLinkSequence);
                }
            });
        });

        const hasRecordId = [...previewDetail.recordIdsByObjectApiName.values()].some(recordIds => recordIds.some(recordId => recordId !== undefined));
        if ( !hasRecordId ) {
            return undefined;
        }

        const { heldSource, ...previewFields } = previewDetail;
        let heldSourceToken = this.heldSourceTokens.get(heldSource);
        if ( heldSourceToken === undefined ) {
            heldSourceToken = ++this.heldSourceTokenSequence;
            this.heldSourceTokens.set(heldSource, heldSourceToken);
        }

        const recordLinkSequence = ++this.recordLinkSequence;
        panelState.pendingOpenableRecordPreviews.set(recordLinkSequence, { ...previewFields, heldSourceToken: heldSourceToken, recordLinkSequence: recordLinkSequence });

        return recordLinkSequence;

    }

}
