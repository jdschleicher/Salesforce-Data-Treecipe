/*
    Reads and drives Target Org Manager's searchable dropdown (#678) on the panel harness's fake page,
    as a reader would: the closed button's text, the options the open popup lists, and a click on
    one. Opening to read is undone, so a probe leaves the picker as it found it.
*/
const findAllByClass = (rootElement: any, className: string): any[] => {
    const matchingElements: any[] = [];
    const visit = (element: any) => {
        if ( element.classList.contains(className) ) { matchingElements.push(element); }
        element.children.forEach(visit);
    };
    visit(rootElement);
    return matchingElements;
};

export const orgPickerTriggerOf = (pickerElement: any): any => findAllByClass(pickerElement, 'sdtSearchableSelectTrigger')[0];
export const orgPickerSearchOf = (pickerElement: any): any => findAllByClass(pickerElement, 'sdtSearchableSelectSearch')[0];
export const orgPickerPopupOf = (pickerElement: any): any => findAllByClass(pickerElement, 'sdtSearchableSelectPopup')[0];
export const isOrgPickerOpen = (pickerElement: any): boolean => orgPickerTriggerOf(pickerElement).attributes['aria-expanded'] === 'true';
export const isOrgPickerDisabled = (pickerElement: any): boolean => orgPickerTriggerOf(pickerElement).disabled === true;

// WHAT THE CLOSED BUTTON SAYS: THE CHOSEN ORG, "Choose org…", OR A PLACEHOLDER SUCH AS "Loading orgs…"
export const shownOrgLabelOf = (pickerElement: any): string => orgPickerTriggerOf(pickerElement).textContent;

export const shownOptionElementsOf = (pickerElement: any): any[] => findAllByClass(pickerElement, 'sdtSearchableSelectOption');

// THE INDEX AN OPTION CARRIES IN ITS id: THE HOST'S INDEX, WHATEVER THE SEARCH LEAVES SHOWN
export const optionIndexOf = (optionElement: any): number => Number(/-option-(\d+)$/.exec(optionElement.attributes.id)?.[1]);

function withOpenPicker<TResult>(pickerElement: any, read: () => TResult): TResult {
    const wasOpen = isOrgPickerOpen(pickerElement);
    if ( !wasOpen ) { orgPickerTriggerOf(pickerElement).dispatch('click'); }
    const result = read();
    if ( !wasOpen && isOrgPickerOpen(pickerElement) ) { orgPickerTriggerOf(pickerElement).dispatch('click'); }
    return result;
}

// THE LABELS THE OPEN POPUP LISTS; NONE WHEN IT CANNOT OPEN (A PLACEHOLDER, OR DISABLED)
export const orgOptionLabelsOf = (pickerElement: any): string[] =>
    withOpenPicker(pickerElement, () => isOrgPickerOpen(pickerElement) ? shownOptionElementsOf(pickerElement).map(optionElement => optionElement.textContent) : []);

export const selectedOrgIndexOf = (pickerElement: any): number | null =>
    withOpenPicker(pickerElement, () => {
        const selectedOption = shownOptionElementsOf(pickerElement).find(optionElement => optionElement.attributes['aria-selected'] === 'true');
        return selectedOption ? optionIndexOf(selectedOption) : null;
    });

export const orgPickerShapeOf = (pickerElement: any) => ({ shown: shownOrgLabelOf(pickerElement), options: orgOptionLabelsOf(pickerElement) });

export function chooseOrgOption(pickerElement: any, optionLabel: string): void {
    if ( !isOrgPickerOpen(pickerElement) ) { orgPickerTriggerOf(pickerElement).dispatch('click'); }
    if ( !isOrgPickerOpen(pickerElement) ) { throw new Error(`The org picker lists no "${optionLabel}": it did not open.`); }
    const optionElement = shownOptionElementsOf(pickerElement).find(shownOption => shownOption.textContent === optionLabel);
    if ( !optionElement ) { throw new Error(`The org picker lists no "${optionLabel}".`); }
    optionElement.dispatch('click');
}

export function typeOrgSearch(pickerElement: any, searchText: string): void {
    if ( !isOrgPickerOpen(pickerElement) ) { orgPickerTriggerOf(pickerElement).dispatch('click'); }
    const searchElement = orgPickerSearchOf(pickerElement);
    searchElement.value = searchText;
    searchElement.dispatch('input');
}
