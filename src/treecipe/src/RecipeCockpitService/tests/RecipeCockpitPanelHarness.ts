import { RecipeCockpitService, RECIPE_COCKPIT_PENDING_ACKNOWLEDGEMENT } from '../RecipeCockpitService';

/*
    Runs the panel's ACTUAL script against a fake DOM. Shared by every suite that drives the panel.

    Asserting on the shell as a string says a listener is present; it says nothing about what
    it does with what it receives. The fake answers classList.contains from the classes an
    element actually CARRIES -- including those set through className -- because the panel
    collapses an object body by creating it with the "hidden" class.
*/
export function runPanelScript() {

    const postedHostMessages: any[] = [];
    const windowListenersByType: Record<string, Function> = {};

    const buildFakeElement = (tagName: string, initialClassName = ''): any => {

        const carriedClassNames = new Set<string>();
        const applyClassName = (nextClassName: string) => {
            carriedClassNames.clear();
            String(nextClassName || '').split(' ').filter(className => !!className).forEach(className => carriedClassNames.add(className));
        };
        applyClassName(initialClassName);

        const listenersByEventType: Record<string, Function[]> = {};

        return {
            tagName: tagName,
            attributes: {} as Record<string, string>,
            value: '',
            selected: false,
            children: [] as any[],
            ownTextContent: '',
            get className() { return Array.from(carriedClassNames).join(' '); },
            set className(nextClassName: string) { applyClassName(nextClassName); },
            // ASSIGNING '' IS HOW THE PANEL CLEARS A CONTAINER, SO IT HAS TO DROP THE CHILDREN TOO
            get textContent() { return this.ownTextContent; },
            set textContent(nextTextContent: string) {
                this.ownTextContent = nextTextContent;
                this.children.length = 0;
            },
            classList: {
                add(className: string) { carriedClassNames.add(className); },
                remove(className: string) { carriedClassNames.delete(className); },
                contains(className: string) { return carriedClassNames.has(className); }
            },
            setAttribute(attributeName: string, attributeValue: string) { this.attributes[attributeName] = String(attributeValue); },
            appendChild(childElement: any) { this.children.push(childElement); return childElement; },
            addEventListener(eventType: string, listener: Function) {
                (listenersByEventType[eventType] = listenersByEventType[eventType] || []).push(listener);
            },
            dispatch(eventType: string) { (listenersByEventType[eventType] || []).forEach(listener => listener({})); }
        };

    };

    const loadStatusElement = buildFakeElement('div', 'loadStatus');
    loadStatusElement.textContent = RECIPE_COCKPIT_PENDING_ACKNOWLEDGEMENT;
    const cockpitBodyElement = buildFakeElement('div');

    const fakeDocument = {
        getElementById: (elementId: string) => ({ loadStatus: loadStatusElement, cockpitBody: cockpitBodyElement } as any)[elementId],
        createElement: (tagName: string) => buildFakeElement(tagName)
    };

    const fakeWindow = {
        addEventListener: (eventType: string, listener: Function) => { windowListenersByType[eventType] = listener; }
    };

    const acquireVsCodeApi = () => ({ postMessage: (hostMessage: any) => { postedHostMessages.push(hostMessage); } });

    const shellHtml = RecipeCockpitService.buildWebviewShellHtml('testNonce');
    const panelScript = shellHtml.substring(
        shellHtml.indexOf('<script nonce="testNonce">') + '<script nonce="testNonce">'.length,
        shellHtml.lastIndexOf('</script>')
    );

    // RUNNING THE REAL PANEL SCRIPT IS THE POINT OF THIS HARNESS
    new Function('document', 'window', 'acquireVsCodeApi', panelScript)(fakeDocument, fakeWindow, acquireVsCodeApi);

    const findAll = (rootElement: any, className: string): any[] => {
        const matchingElements: any[] = [];
        const visit = (element: any) => {
            if (element.classList.contains(className)) { matchingElements.push(element); }
            element.children.forEach(visit);
        };
        visit(rootElement);
        return matchingElements;
    };

    const isHidden = (element: any) => element.classList.contains('hidden');

    const objectElements = () => findAll(cockpitBodyElement, 'object');
    const objectHeaderOf = (objectElement: any) => objectElement.children[0];
    const objectBodyOf = (objectElement: any) => objectElement.children[1];

    return {
        postedHostMessages,
        loadStatusElement,
        cockpitBodyElement,
        findAll,
        isHidden,
        objectElements,
        objectBodyOf,
        objectNameOf: (objectElement: any) => findAll(objectHeaderOf(objectElement), 'objectName')[0].textContent,
        objectCountOf: (objectElement: any) => findAll(objectHeaderOf(objectElement), 'objectCount')[0].textContent,
        visibleFieldNamesOf: (objectElement: any) => findAll(objectBodyOf(objectElement), 'field')
            .filter(fieldElement => !isHidden(fieldElement))
            .map(fieldElement => findAll(fieldElement, 'fieldName')[0].textContent),
        typeIntoFilter: (filterText: string) => {
            const filterInputElement = findAll(cockpitBodyElement, 'filterInput')[0];
            filterInputElement.value = filterText;
            filterInputElement.dispatch('input');
        },
        // A KEYSTROKE FILTERS ONLY THE VIEW ON SCREEN, SO A TEST OF THE CLASSIC LIST'S FILTER SWITCHES TO IT FIRST, AS A READER WOULD
        showClassicList: () => findAll(cockpitBodyElement, 'viewButton').find((element: any) => element.textContent === 'Classic list').dispatch('click'),
        postToPanel: (hostMessage: any) => windowListenersByType['message']({ data: hostMessage }),
        raiseWindowError: (errorEvent: any) => windowListenersByType['error'](errorEvent)
    };

}
