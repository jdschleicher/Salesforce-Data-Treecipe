import { RecipeCockpitService, RECIPE_COCKPIT_PENDING_ACKNOWLEDGEMENT } from '../RecipeCockpitService';

/*
    Runs the panel's ACTUAL script against a fake DOM. Shared by every suite that drives the panel.

    Asserting on the shell as a string says a listener is present; it says nothing about what
    it does with what it receives. The fake answers classList.contains from the classes an
    element actually CARRIES -- including those set through className -- because the panel
    collapses an object body by creating it with the "hidden" class.

    A dispatched event BUBBLES through every ancestor until a listener stops it, as a browser's
    click does, because the tree card's header answers clicks on everything inside it. A DISABLED
    element runs none of its own listeners but the event still reaches its ancestors -- the worst
    case a browser can give, so a panel that holds up against it holds up against them all.
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
            disabled: false,
            parentNode: null as any,
            children: [] as any[],
            ownTextContent: '',
            get className() { return Array.from(carriedClassNames).join(' '); },
            set className(nextClassName: string) { applyClassName(nextClassName); },
            // ASSIGNING '' IS HOW THE PANEL CLEARS A CONTAINER, SO IT HAS TO DROP THE CHILDREN TOO
            get textContent() { return this.ownTextContent; },
            set textContent(nextTextContent: string) {
                this.ownTextContent = nextTextContent;
                // A DETACHED ELEMENT MUST NOT BUBBLE INTO ITS FORMER ANCESTORS
                this.children.forEach((childElement: any) => { childElement.parentNode = null; });
                this.children.length = 0;
            },
            classList: {
                add(className: string) { carriedClassNames.add(className); },
                remove(className: string) { carriedClassNames.delete(className); },
                contains(className: string) { return carriedClassNames.has(className); }
            },
            setAttribute(attributeName: string, attributeValue: string) { this.attributes[attributeName] = String(attributeValue); },
            appendChild(childElement: any) { this.children.push(childElement); childElement.parentNode = this; return childElement; },
            addEventListener(eventType: string, listener: Function) {
                (listenersByEventType[eventType] = listenersByEventType[eventType] || []).push(listener);
            },
            listenersByEventType: listenersByEventType,
            dispatch(eventType: string) {
                let isPropagationStopped = false;
                const event = { type: eventType, target: this, stopPropagation: () => { isPropagationStopped = true; } };
                for (let currentElement: any = this; currentElement && !isPropagationStopped; currentElement = currentElement.parentNode) {
                    if ( currentElement.disabled ) { continue; }
                    (currentElement.listenersByEventType[eventType] || []).forEach((listener: Function) => listener(event));
                }
            }
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

    // THE STRUCTURE TAB'S OBJECTS, OF EVERY CARD WHOSE BODY IS BUILT -- A COLLAPSED CARD HAS NOT ATTACHED ITS OBJECTS YET
    const objectElements = () => findAll(cockpitBodyElement, 'treeObject');
    const objectHeaderOf = (objectElement: any) => objectElement.children[0];
    const objectBodyOf = (objectElement: any) => objectElement.children[1];
    const treeCards = () => findAll(cockpitBodyElement, 'treeCard');

    return {
        postedHostMessages,
        loadStatusElement,
        cockpitBodyElement,
        findAll,
        isHidden,
        treeCards,
        objectElements,
        objectBodyOf,
        objectNameOf: (objectElement: any) => findAll(objectHeaderOf(objectElement), 'treeObjectName')[0].textContent,
        objectCountOf: (objectElement: any) => findAll(objectHeaderOf(objectElement), 'treeObjectCount')[0].textContent,
        visibleFieldNamesOf: (objectElement: any) => findAll(objectBodyOf(objectElement), 'treeField')
            .filter(fieldElement => !isHidden(fieldElement))
            .map(fieldElement => findAll(fieldElement, 'treeFieldName')[0].textContent),
        fieldRowNamed: (objectElement: any, fieldApiName: string) => findAll(objectBodyOf(objectElement), 'treeField')
            .find(fieldElement => findAll(fieldElement, 'treeFieldName')[0].textContent === fieldApiName),
        expandObject: (objectElement: any) => findAll(objectHeaderOf(objectElement), 'treeObjectToggle')[0].dispatch('click'),
        // EVERY CARD OPENED BY ITS TOGGLE, AS A READER WOULD, SO ITS STRUCTURE TAB IS ATTACHED
        expandAllTrees: () => treeCards().forEach(treeCard => findAll(treeCard, 'treeToggle')[0].dispatch('click')),
        typeIntoFilter: (filterText: string) => {
            const filterInputElement = findAll(cockpitBodyElement, 'filterInput')[0];
            filterInputElement.value = filterText;
            filterInputElement.dispatch('input');
        },
        postToPanel: (hostMessage: any) => windowListenersByType['message']({ data: hostMessage }),
        raiseWindowError: (errorEvent: any) => windowListenersByType['error'](errorEvent)
    };

}
