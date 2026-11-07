/*
    The page RecipeCockpitPanelHarness's fake DOM holds, written back out as the HTML document a
    browser would have built (#602), so real Chromium can draw what a journey reached with the shell's
    own stylesheet. The shell's script is left out: the page is already drawn, and running the script
    again would draw it a second time from nothing.

    It lives beside the harness rather than in tests/acceptance/ because writing a page out reads every
    element's classes, which a journey never does (AcceptanceSelectorScan).
*/
export interface IFakePageElement {
    tagName: string;
    className: string;
    attributes: Record<string, string>;
    children: IFakePageElement[];
    textContent: string;
    value: string;
    disabled: boolean;
    selected?: boolean;
    checked?: boolean;
    namespaceURI?: string;
}

// ELEMENTS HTML WRITES WITH NO CLOSING TAG AND NO CONTENT
const VOID_TAG_NAMES = new Set(['area', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

const escapeText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttribute = (attributeValue: string) => escapeText(attributeValue).replace(/"/g, '&quot;');

export class RecipeCockpitPageDocument {

    /*
        The shell with each root's markup replaced by the root as the panel left it. A root is found by
        the id the shell gives it, and must be there exactly once with nothing but text inside: a shell
        reshaped so that is no longer true needs this updated, never a screenshot of a page half drawn.
    */
    static buildDocumentHtml(shellHtml: string, rootsById: Record<string, IFakePageElement>): string {

        const scriptStart = shellHtml.search(/<script nonce="[^"]+">/);
        const scriptEnd = shellHtml.lastIndexOf('</script>');
        if ( scriptStart === -1 || scriptEnd === -1 ) {
            throw new Error('The panel document has no nonced <script> to leave out.');
        }
        let documentHtml = shellHtml.substring(0, scriptStart) + shellHtml.substring(scriptEnd + '</script>'.length);

        for ( const [rootId, rootElement] of Object.entries(rootsById) ) {
            // ONLY id AND class ARE ALLOWED ON A ROOT: ANY OTHER ATTRIBUTE THE SHELL GAVE IT WOULD BE LOST IN THE REPLACEMENT
            const rootMarkup = new RegExp(`<div id="${rootId}"(?: class="[^"]*")?>[^<]*</div>`, 'g');
            const matchCount = (documentHtml.match(rootMarkup) ?? []).length;
            if ( matchCount !== 1 ) {
                throw new Error(`The panel document has ${matchCount} <div id="${rootId}"> with only an id and a class and holding only text, where it should have one: update RecipeCockpitPageDocument for the shell's new markup.`);
            }
            documentHtml = documentHtml.replace(rootMarkup, () => this.serializeElement(rootElement, { id: rootId }));
        }

        return documentHtml;

    }

    static serializeElement(element: IFakePageElement, extraAttributes: Record<string, string> = {}, parentElement?: IFakePageElement): string {

        const tagName = String(element.tagName).toLowerCase();
        const attributes: Record<string, string> = { ...extraAttributes, ...element.attributes };
        if ( element.className ) { attributes.class = element.className; }
        if ( element.disabled ) { attributes.disabled = ''; }
        if ( element.checked ) { attributes.checked = ''; }
        if ( tagName === 'input' && element.value ) { attributes.value = element.value; }
        if ( tagName === 'option' && this.isSelectedOption(element, parentElement) ) { attributes.selected = ''; }
        if ( tagName === 'option' && element.value && attributes.value === undefined ) { attributes.value = element.value; }

        const openingTag = '<' + tagName + Object.entries(attributes)
            .map(([attributeName, attributeValue]) => attributeValue === '' ? ` ${attributeName}` : ` ${attributeName}="${escapeAttribute(attributeValue)}"`)
            .join('') + '>';

        if ( VOID_TAG_NAMES.has(tagName) ) {
            return openingTag;
        }

        // A TEXTAREA SHOWS ITS VALUE, NOT THE TEXT IT WAS CREATED WITH
        const ownText = tagName === 'textarea' && element.value ? element.value : element.textContent;
        const content = escapeText(ownText ?? '') + element.children.map(childElement => this.serializeElement(childElement, {}, element)).join('');

        return openingTag + content + `</${tagName}>`;

    }

    // THE PANEL SETS A SELECT'S value OR AN OPTION'S selected; THE FAKE DOM, UNLIKE A BROWSER, DOES NOT KEEP THE TWO IN STEP
    private static isSelectedOption(optionElement: IFakePageElement, selectElement?: IFakePageElement): boolean {
        if ( optionElement.selected ) { return true; }
        if ( !selectElement || selectElement.value === '' ) { return false; }
        const optionValue = optionElement.value || optionElement.attributes.value || optionElement.textContent;
        return optionValue === selectElement.value;
    }

}
