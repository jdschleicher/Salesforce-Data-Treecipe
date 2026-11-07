jest.mock('vscode', () => ({}), { virtual: true });

import { RecipeCockpitService } from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { IFakePageElement, RecipeCockpitPageDocument } from './RecipeCockpitPageDocument';

/*
    #602: the fake page written out as the document Chromium draws. What the panel set on an element
    must reach the document as a browser would have it, and nothing the panel wrote may reach it as markup.
*/
const fakeElement = (tagName: string, fields: Partial<IFakePageElement> = {}): IFakePageElement => ({
    tagName, className: '', attributes: {}, children: [], textContent: '', value: '', disabled: false, ...fields
});

describe('RecipeCockpitPageDocument.serializeElement', () => {

    test('writes text and attribute values escaped, so workspace text never becomes markup', () => {
        const element = fakeElement('div', { className: 'treeTitle', attributes: { 'aria-label': 'say "hi" & <b>' }, textContent: '<script>alert(1)</script>' });
        expect(RecipeCockpitPageDocument.serializeElement(element))
            .toBe('<div aria-label="say &quot;hi&quot; &amp; &lt;b&gt;" class="treeTitle">&lt;script&gt;alert(1)&lt;/script&gt;</div>');
    });

    test('writes an element\'s own text before its children, as setting textContent then appending does', () => {
        const element = fakeElement('button', { textContent: 'Edit', children: [fakeElement('span', { textContent: '3' })] });
        expect(RecipeCockpitPageDocument.serializeElement(element)).toBe('<button>Edit<span>3</span></button>');
    });

    test('writes disabled, checked and an input\'s value as attributes, and an input with no closing tag', () => {
        const element = fakeElement('input', { attributes: { type: 'checkbox' }, disabled: true, checked: true, value: 'on' });
        expect(RecipeCockpitPageDocument.serializeElement(element)).toBe('<input type="checkbox" disabled checked value="on">');
    });

    test('shows a textarea\'s value rather than the text it was created with', () => {
        expect(RecipeCockpitPageDocument.serializeElement(fakeElement('textarea', { textContent: 'old', value: 'EMEA' }))).toBe('<textarea>EMEA</textarea>');
    });

    test('marks selected the option whose value the select holds, or the option the panel selected', () => {
        const select = fakeElement('select', { value: '1', children: [fakeElement('option', { value: '0', textContent: 'A' }), fakeElement('option', { value: '1', textContent: 'B' })] });
        expect(RecipeCockpitPageDocument.serializeElement(select)).toBe('<select><option value="0">A</option><option selected value="1">B</option></select>');

        const selectedByOption = fakeElement('select', { children: [fakeElement('option', { textContent: 'A' }), fakeElement('option', { textContent: 'B', selected: true })] });
        expect(RecipeCockpitPageDocument.serializeElement(selectedByOption)).toBe('<select><option>A</option><option selected>B</option></select>');
    });

});

describe('RecipeCockpitPageDocument.buildDocumentHtml', () => {

    test('leaves out the shell\'s script and puts each root back by its id, keeping the stylesheet', () => {
        const shellHtml = RecipeCockpitService.buildWebviewShellHtml('documentNonce');
        const page = runPanelScript({ shellHtml });
        page.cockpitBodyElement.appendChild(fakeElement('p', { textContent: 'drawn' }));

        const documentHtml = RecipeCockpitPageDocument.buildDocumentHtml(shellHtml, {
            cockpitMeta: page.cockpitMetaElement,
            loadStatus: page.loadStatusElement,
            cockpitBody: page.cockpitBodyElement,
            cockpitDialogHost: page.cockpitDialogHostElement
        });

        expect(documentHtml).not.toContain('<script');
        expect(documentHtml).toContain('<style nonce="documentNonce">');
        expect(documentHtml).toContain('<div id="cockpitBody"><p>drawn</p></div>');
        expect(documentHtml).toContain('<div id="cockpitMeta" class="cockpitMeta">');
        expect(documentHtml).toContain('<div id="cockpitDialogHost"></div>');
    });

    test('refuses a shell whose root is missing, naming it, rather than drawing a page half filled', () => {
        const shellHtml = '<html><body><div id="cockpitBody"></div><script nonce="n">x</script></body></html>';
        expect(() => RecipeCockpitPageDocument.buildDocumentHtml(shellHtml, { cockpitMeta: fakeElement('div') }))
            .toThrow('The panel document has 0 <div id="cockpitMeta"> with only an id and a class');
    });

    test('refuses a root that carries an attribute besides id and class, which the replacement would lose', () => {
        const shellHtml = '<html><body><div id="cockpitBody" hidden></div><script nonce="n">x</script></body></html>';
        expect(() => RecipeCockpitPageDocument.buildDocumentHtml(shellHtml, { cockpitBody: fakeElement('div') }))
            .toThrow('The panel document has 0 <div id="cockpitBody"> with only an id and a class');
    });

    test('refuses a shell with no nonced script', () => {
        expect(() => RecipeCockpitPageDocument.buildDocumentHtml('<html></html>', {})).toThrow('no nonced <script>');
    });

});
