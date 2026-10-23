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

    savedState is what vscodeApi.getState answers, as VS Code answers it for a document it reloaded
    after the tab was hidden; savedState() returns whatever the panel last handed to setState, so a
    test can save in one run of the script and restore in the next.
*/
export interface IPanelScriptOptions {
    savedState?: any;
    isStateApiMissing?: boolean;
    // WHAT window.matchMedia('(prefers-reduced-motion: reduce)') ANSWERS; LEFT OUT, THE WINDOW HAS NO matchMedia AT ALL
    prefersReducedMotion?: boolean;
}

export function runPanelScript(panelScriptOptions: IPanelScriptOptions = {}) {

    const postedHostMessages: any[] = [];
    const documentCaptureListenersByType: Record<string, Function[]> = {};
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
            // THE FOCUSED ELEMENT IS document.activeElement, AS IN A BROWSER (#349)
            focus() { fakeDocument.activeElement = this; },
            setAttribute(attributeName: string, attributeValue: string) { this.attributes[attributeName] = String(attributeValue); },
            removeAttribute(attributeName: string) { delete this.attributes[attributeName]; },
            appendChild(childElement: any) { this.children.push(childElement); childElement.parentNode = this; return childElement; },
            // A ROW ADDED IN PLACE (#226) GOES ABOVE THE ROWS ALREADY THERE; A REFERENCE THAT IS NOT A CHILD THROWS, AS THE DOM'S DOES
            insertBefore(childElement: any, referenceElement: any) {
                if ( referenceElement === null ) { return this.appendChild(childElement); }
                const referenceIndex = this.children.indexOf(referenceElement);
                if ( referenceIndex === -1 ) { throw new Error('insertBefore: the reference element is not a child of this element'); }
                this.children.splice(referenceIndex, 0, childElement);
                childElement.parentNode = this;
                return childElement;
            },
            get firstChild() { return this.children[0] ?? null; },
            // THE RECORD TYPES SECTION SCROLLS TO THE OBJECT "Change record types" NAMES (#321); COUNTED, SINCE THERE IS NO LAYOUT
            scrolledIntoViewCount: 0,
            scrollIntoView() { this.scrolledIntoViewCount++; },
            addEventListener(eventType: string, listener: Function) {
                (listenersByEventType[eventType] = listenersByEventType[eventType] || []).push(listener);
            },
            listenersByEventType: listenersByEventType,
            // eventInit CARRIES WHAT A REAL EVENT WOULD, SUCH AS THE key OF A keydown
            dispatch(eventType: string, eventInit: Record<string, unknown> = {}) {
                let isPropagationStopped = false;
                const event = { ...eventInit, type: eventType, target: this, stopPropagation: () => { isPropagationStopped = true; } };
                // A CAPTURING DOCUMENT LISTENER HEARS EVERY EVENT FIRST, WHATEVER THE ELEMENTS UNDER IT DO WITH IT (#380)
                (documentCaptureListenersByType[eventType] || []).forEach((listener: Function) => listener(event));
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
    // THE TOP RIGHT OF THE TITLE ROW (#333): THE VERSION AND THE CHANGELOG LINK, OUTSIDE THE BODY
    const cockpitMetaElement = buildFakeElement('div', 'cockpitMeta');
    // WHERE AN IN-PANEL CONFIRMATION IS DRAWN (#349), OUTSIDE THE BODY
    const cockpitDialogHostElement = buildFakeElement('div');

    const fakeDocument: any = {
        activeElement: null,
        // RUN AS CAPTURING LISTENERS, BEFORE THE TARGET'S OWN: THE PANEL'S ONE DOCUMENT LISTENER CAPTURES (#380)
        addEventListener: (eventType: string, listener: Function) => {
            (documentCaptureListenersByType[eventType] = documentCaptureListenersByType[eventType] || []).push(listener);
        },
        getElementById: (elementId: string) => ({ loadStatus: loadStatusElement, cockpitBody: cockpitBodyElement, cockpitMeta: cockpitMetaElement, cockpitDialogHost: cockpitDialogHostElement } as any)[elementId],
        createElement: (tagName: string) => buildFakeElement(tagName),
        // THE TREE GLYPH IS INLINE SVG (#219); ITS NAMESPACE IS KEPT SO A TEST CAN SAY IT WAS NOT AN HTML ELEMENT
        createElementNS: (namespaceUri: string, tagName: string) => Object.assign(buildFakeElement(tagName), { namespaceURI: namespaceUri })
    };

    const scrollToCalls: number[] = [];
    const fakeWindow: any = {
        scrollY: 0,
        scrollTo(scrollX: number, scrollY: number) { scrollToCalls.push(scrollY); this.scrollY = scrollY; },
        addEventListener: (eventType: string, listener: Function) => { windowListenersByType[eventType] = listener; }
    };
    if ( panelScriptOptions.prefersReducedMotion !== undefined ) {
        fakeWindow.matchMedia = (mediaQuery: string) => ({ matches: mediaQuery === '(prefers-reduced-motion: reduce)' && !!panelScriptOptions.prefersReducedMotion });
    }

    let savedState: any = panelScriptOptions.savedState;
    const setStateCalls: any[] = [];
    const acquireVsCodeApi = () => (panelScriptOptions.isStateApiMissing
        ? { postMessage: (hostMessage: any) => { postedHostMessages.push(hostMessage); } }
        : {
            postMessage: (hostMessage: any) => { postedHostMessages.push(hostMessage); },
            getState: () => savedState,
            // VS CODE KEEPS A SERIALIZED COPY, SO THE PANEL CANNOT REACH BACK INTO WHAT IT SAVED
            setState: (nextState: any) => { savedState = JSON.parse(JSON.stringify(nextState)); setStateCalls.push(savedState); return nextState; }
        });

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
    const typeIntoSearch = (panelElement: any, searchText: string) => {
        const searchInputElement = findAll(panelElement, 'tabSearchInput')[0];
        searchInputElement.value = searchText;
        searchInputElement.dispatch('input');
    };

    return {
        postedHostMessages,
        savedState: () => savedState,
        setStateCalls,
        scrollToCalls,
        scrollTo: (scrollY: number) => { fakeWindow.scrollY = scrollY; windowListenersByType['scroll']({ type: 'scroll' }); },
        loadStatusElement,
        cockpitBodyElement,
        cockpitMetaElement,
        cockpitDialogHostElement,
        activeElement: () => fakeDocument.activeElement,
        findAll,
        isHidden,
        // AN ACTION CARD (#381, #384) NAMES ITSELF IN ITS TITLE SPAN, NOT ITS OWN TEXT
        cardTitleOf: (buttonElement: any) => findAll(buttonElement, 'actionCardTitle')[0].textContent,
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
        // EVERY CARD CHOSEN IN THE TREECIPES DROPDOWN (#374), AS A READER WOULD, SO ITS STRUCTURE TAB IS ATTACHED; THE FIRST IS CHOSEN LAST
        expandAllTrees: () => {
            const pickerElement = findAll(cockpitBodyElement, 'treePickerSelect')[0];
            if ( !pickerElement ) { return; }
            const optionCount = pickerElement.children.length;
            [...Array.from({ length: optionCount }, (_, optionIndex) => optionIndex).slice(1), 0].forEach(optionIndex => {
                pickerElement.value = String(optionIndex);
                pickerElement.dispatch('change');
            });
        },
        // THE TREECIPES DROPDOWN (#374), ITS OPTIONS' LABELS, AND A CARD CHOSEN BY THE LABEL ITS OPTION DRAWS
        treePicker: () => findAll(cockpitBodyElement, 'treePickerSelect')[0],
        treePickerLabels: () => (findAll(cockpitBodyElement, 'treePickerSelect')[0]?.children ?? []).map((optionElement: any) => optionElement.textContent),
        chooseTreeByLabel: (optionLabel: string) => {
            const pickerElement = findAll(cockpitBodyElement, 'treePickerSelect')[0];
            const optionIndex = pickerElement.children.findIndex((optionElement: any) => optionElement.textContent === optionLabel);
            if ( optionIndex === -1 ) { throw new Error('No treecipe option labelled ' + optionLabel); }
            pickerElement.value = String(optionIndex);
            pickerElement.dispatch('change');
        },
        // A CARD CHOSEN IN THE DROPDOWN BY THE TITLE ITS HEADER DRAWS -- WHAT OPENING IT WAS BEFORE A CARD STOPPED FOLDING (#374)
        chooseTreeCard: (treeCard: any) => {
            const pickerElement = findAll(cockpitBodyElement, 'treePickerSelect')[0];
            const title = findAll(treeCard, 'treeTitle')[0].textContent;
            const optionIndex = pickerElement.children.findIndex((optionElement: any) => optionElement.textContent === title || optionElement.textContent === '★ ' + title);
            if ( optionIndex === -1 ) { throw new Error('No treecipe option for ' + title); }
            pickerElement.value = String(optionIndex);
            pickerElement.dispatch('change');
        },
        // THE CARD THE DROPDOWN DRAWS: THE ONE NOT HIDDEN
        shownTreeCards: () => treeCards().filter(treeCard => !isHidden(treeCard)),
        typeIntoTreecipesSearch: (searchText: string) => {
            const searchInputElement = findAll(cockpitBodyElement, 'treecipesSearchInput')[0];
            searchInputElement.value = searchText;
            searchInputElement.dispatch('input');
        },
        // THE TROUBLESHOOTING TAB OF EVERY CARD THAT DRAWS ONE (#346), BUILT AND SELECTED; THE CARDS MUST BE OPEN
        openTroubleshootingTabs: () => treeCards().forEach(treeCard => findAll(treeCard, 'treeTab')
            .filter((candidateElement: any) => candidateElement.textContent === 'Troubleshooting')
            .forEach((tabElement: any) => tabElement.dispatch('click'))),
        // A CARD'S TAB, BY THE LABEL ITS BUTTON DRAWS; ITS PANEL, BY THE CLASS THE PANEL CARRIES
        openTab: (treeCard: any, tabLabel: string) => findAll(treeCard, 'treeTab')
            .find((candidateElement: any) => candidateElement.textContent === tabLabel).dispatch('click'),
        tabPanelOf: (treeCard: any, panelClassName: string) => findAll(treeCard, panelClassName)[0],
        // THE TREECIPE ADAPTER'S TAB (#443), OPENED AND PAST STEP 1 ON THE PARENT ITS DROPDOWN SHOWS (THE ROOT UNLESS CHANGED);
        // A TAB A PLACE OPENED ON STEP 2 IS LEFT THERE
        openAdapterStructure: (treeCard: any, tabLabel: string) => {
            findAll(treeCard, 'treeTab').find((candidateElement: any) => candidateElement.textContent === tabLabel).dispatch('click');
            const parentStepElement = findAll(treeCard, 'updaterParentStep')[0];
            if (parentStepElement && !isHidden(parentStepElement)) { findAll(parentStepElement, 'updaterNext')[0].dispatch('click'); }
        },
        // EVERY TAB HAS ITS OWN SEARCH BOX (#217); THE CARD MUST BE OPEN AND THE TAB BUILT
        typeIntoTabSearch: (treeCard: any, panelClassName: string, searchText: string) => typeIntoSearch(findAll(treeCard, panelClassName)[0], searchText),
        // THE STRUCTURE TAB'S SEARCH OF ONE CARD -- THE FIRST, UNLESS ONE IS NAMED
        typeIntoFilter: (searchText: string, treeCard?: any) => typeIntoSearch(findAll(treeCard || treeCards()[0], 'treeStructure')[0], searchText),
        // THE DATA-BY-ORG TAB'S OBJECT ROWS, OF EVERY CARD WHOSE TAB IS BUILT
        postToPanel: (hostMessage: any) => windowListenersByType['message']({ data: hostMessage }),
        raiseWindowError: (errorEvent: any) => windowListenersByType['error'](errorEvent)
    };

}
