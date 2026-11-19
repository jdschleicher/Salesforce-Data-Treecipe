/*
    The webview's one connection to the host and the four elements the shell's markup holds (#657).
    startRecipeCockpitPanel connects them once, before anything is drawn; every module reads them
    from here. acquireVsCodeApi may be called only once per document, so nothing else calls it.
*/

declare function acquireVsCodeApi(): IVsCodeApi;

export interface IVsCodeApi {
    postMessage(message: unknown): void;
    getState?: () => unknown;
    setState?: (panelPlace: unknown) => unknown;
}

let acquiredVsCodeApi: IVsCodeApi | null = null;

// THE ONE OBJECT EVERY MODULE POSTS THROUGH; A MODULE THAT POSTS ONLY ITS OWN COMMANDS NAMES THEM IN ITS OWN TYPE FOR IT
export const vscodeApi: IVsCodeApi = {
    postMessage(message: unknown): void {
        ( acquiredVsCodeApi as IVsCodeApi ).postMessage(message);
    },
    // A HOST THAT GIVES NO STATE API GIVES THE PANEL NO PLACE TO KEEP OR READ: THE PLACE MODULE CHECKS FOR EACH
    get getState() {
        const getState = acquiredVsCodeApi ? acquiredVsCodeApi.getState : undefined;
        return typeof getState === 'function' ? getState.bind(acquiredVsCodeApi) : undefined;
    },
    get setState() {
        const setState = acquiredVsCodeApi ? acquiredVsCodeApi.setState : undefined;
        return typeof setState === 'function' ? setState.bind(acquiredVsCodeApi) : undefined;
    }
};

export let loadStatusElement: HTMLElement | null = null;
export let cockpitBodyElement: HTMLElement = null as unknown as HTMLElement;
export let cockpitMetaElement: HTMLElement | null = null;
export let cockpitDialogHostElement: HTMLElement = null as unknown as HTMLElement;

export function connectPanel(): void {

    acquiredVsCodeApi = acquireVsCodeApi();
    loadStatusElement = document.getElementById('loadStatus');
    cockpitBodyElement = document.getElementById('cockpitBody') as HTMLElement;
    cockpitMetaElement = document.getElementById('cockpitMeta');
    cockpitDialogHostElement = document.getElementById('cockpitDialogHost') as HTMLElement;

}
