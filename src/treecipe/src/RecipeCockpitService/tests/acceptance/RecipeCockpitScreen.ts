/*
    What a reader sees of the panel (#577), as an accessibility-style tree: each node a ROLE, a NAME and
    its states, built from the fake page the way a browser builds one -- never from a class or an id the
    markup happens to carry. #565 reshapes the markup; the roles and names a reader goes by stay.

    role   the role attribute, or the element's own (button, select is a combobox, option, input...);
           a div or span has none, and its own text is a "text" node
    name   aria-label, then aria-labelledby, then a <label for>, then the text inside
    shown  what the page's stylesheet does not hide (isDisplayed), and nothing aria-hidden
*/

export interface IPageElement {
    tagName: string;
    attributes: Record<string, string>;
    children: IPageElement[];
    parentNode: IPageElement | null;
    textContent: string;
    value: string;
    disabled: boolean;
    checked?: boolean;
    dispatch(eventType: string, eventInit?: Record<string, unknown>): void;
}

export interface IScreenNode {
    role: string;
    name: string;
    // A COMBOBOX'S SHOWN OPTION, A TEXTBOX'S TEXT
    value?: string;
    states: string[];
    children: IScreenNode[];
}

const ROLE_BY_TAG_NAME: Readonly<Record<string, string>> = {
    button: 'button',
    select: 'combobox',
    option: 'option',
    textarea: 'textbox',
    a: 'link',
    h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
    ul: 'list', ol: 'list', li: 'listitem',
    table: 'table', tr: 'row', th: 'columnheader', td: 'cell',
    details: 'group', summary: 'button',
    label: 'label'
};

const ROLE_BY_INPUT_TYPE: Readonly<Record<string, string>> = { checkbox: 'checkbox', radio: 'radio', search: 'searchbox', button: 'button' };

// A NODE WHOSE NAME IS THE TEXT INSIDE IT, AS A BROWSER NAMES THEM
const ROLES_NAMED_BY_CONTENT = new Set(['button', 'option', 'tab', 'link', 'heading', 'listitem', 'cell', 'columnheader', 'menuitem', 'checkbox', 'radio', 'label', 'text', 'alert']);

export class RecipeCockpitScreen {

    private readonly elementByNode = new Map<IScreenNode, IPageElement>();
    readonly roots: IScreenNode[];

    constructor(private readonly pageRoots: IPageElement[], private readonly isDisplayed: (element: IPageElement) => boolean) {
        this.roots = pageRoots.flatMap(pageRoot => this.buildNodes(pageRoot));
    }

    private isShown(element: IPageElement): boolean {
        return this.isDisplayed(element) && element.attributes['aria-hidden'] !== 'true';
    }

    private roleOf(element: IPageElement): string | undefined {
        const tagName = String(element.tagName).toLowerCase();
        if ( element.attributes.role ) { return element.attributes.role; }
        if ( tagName === 'input' ) { return ROLE_BY_INPUT_TYPE[element.attributes.type] ?? 'textbox'; }
        return ROLE_BY_TAG_NAME[tagName];
    }

    // THE TEXT A READER SEES INSIDE AN ELEMENT: ITS OWN, THEN ITS SHOWN CHILDREN'S
    private shownTextOf(element: IPageElement): string {
        if ( !this.isShown(element) ) { return ''; }
        return [element.textContent, ...element.children.map(child => this.shownTextOf(child))]
            .filter(textPart => !!textPart).join(' ').replace(/\s+/g, ' ').trim();
    }

    private everyPageElement(): IPageElement[] {
        const elements: IPageElement[] = [];
        const visit = (element: IPageElement) => { elements.push(element); element.children.forEach(visit); };
        this.pageRoots.forEach(visit);
        return elements;
    }

    // THE ELEMENT A for, aria-labelledby OR aria-controls POINTS AT: HOW A BROWSER RESOLVES A NAME, NOT HOW A TEST FINDS AN ELEMENT
    private referencedElements(referencedIds: string): IPageElement[] {
        const wantedIds = referencedIds.split(/\s+/).filter(referencedId => !!referencedId);
        return wantedIds.map(wantedId => this.everyPageElement().find(element => element.attributes.id === wantedId)).filter(element => !!element);
    }

    private nameOf(element: IPageElement, role: string): string {
        if ( element.attributes['aria-label'] ) { return element.attributes['aria-label']; }
        if ( element.attributes['aria-labelledby'] ) {
            return this.referencedElements(element.attributes['aria-labelledby']).map(labelElement => this.shownTextOf(labelElement)).join(' ').trim();
        }
        const elementId = element.attributes.id;
        if ( elementId ) {
            const labelElement = this.everyPageElement().find(candidate => String(candidate.tagName).toLowerCase() === 'label' && candidate.attributes.for === elementId);
            if ( labelElement ) { return this.shownTextOf(labelElement); }
        }
        return ROLES_NAMED_BY_CONTENT.has(role) ? this.shownTextOf(element) : '';
    }

    private statesOf(element: IPageElement, role: string): string[] {
        const states: string[] = [];
        if ( element.attributes['aria-selected'] === 'true' ) { states.push('selected'); }
        if ( role === 'option' && element.parentNode && String(element.parentNode.value) === String(element.value) ) { states.push('selected'); }
        if ( element.attributes['aria-expanded'] === 'true' ) { states.push('expanded'); }
        if ( element.attributes['aria-expanded'] === 'false' ) { states.push('collapsed'); }
        if ( element.attributes['aria-checked'] === 'true' || element.checked === true ) { states.push('checked'); }
        if ( element.disabled || element.attributes['aria-disabled'] === 'true' ) { states.push('disabled'); }
        return states;
    }

    private buildNodes(element: IPageElement): IScreenNode[] {

        if ( !this.isShown(element) ) { return []; }

        const role = this.roleOf(element);
        const childNodes = element.children.flatMap(child => this.buildNodes(child));
        const ownTextNodes: IScreenNode[] = element.textContent && role === undefined
            ? [{ role: 'text', name: element.textContent.replace(/\s+/g, ' ').trim(), states: [], children: [] }]
            : [];

        // A DIV OR SPAN IS NO NODE OF ITS OWN: ITS TEXT AND CHILDREN BELONG TO ITS PARENT
        if ( role === undefined || role === 'presentation' || role === 'none' ) {
            return [...ownTextNodes.filter(textNode => !!textNode.name), ...childNodes];
        }

        const node: IScreenNode = {
            role,
            name: this.nameOf(element, role),
            states: this.statesOf(element, role),
            // A NAMED-BY-CONTENT CONTROL'S TEXT IS ITS NAME, SO IT IS NOT REPEATED UNDER IT
            children: ROLES_NAMED_BY_CONTENT.has(role) ? childNodes.filter(childNode => childNode.role !== 'text') : childNodes
        };
        if ( role === 'combobox' ) {
            const shownOption = element.children.find(optionElement => String(optionElement.value) === String(element.value));
            node.value = shownOption ? this.shownTextOf(shownOption) : '';
        }
        if ( role === 'textbox' || role === 'searchbox' ) { node.value = String(element.value); }

        this.elementByNode.set(node, element);
        return [node];

    }

    // EVERY NODE, DEPTH FIRST, IN READING ORDER
    all(): IScreenNode[] {
        const nodes: IScreenNode[] = [];
        const visit = (node: IScreenNode) => { nodes.push(node); node.children.forEach(visit); };
        this.roots.forEach(visit);
        return nodes;
    }

    findAll(role: string, name?: string | RegExp, within?: IScreenNode): IScreenNode[] {
        const nodes = within ? new RecipeCockpitScreenSubtree(within).all() : this.all();
        return nodes.filter(node => node.role === role && (name === undefined || (typeof name === 'string' ? node.name === name : name.test(node.name))));
    }

    // EXACTLY ONE NODE OF THIS ROLE AND NAME, OR AN ERROR THAT SAYS WHAT IS THERE INSTEAD
    get(role: string, name: string | RegExp, within?: IScreenNode): IScreenNode {
        const matches = this.findAll(role, name, within);
        if ( matches.length === 1 ) { return matches[0]; }
        const sameRole = this.findAll(role, undefined, within).map(node => `"${node.name}"`);
        throw new Error(matches.length === 0
            ? `No ${role} named "${name}" is on screen. The ${role}s on screen: ${sameRole.join(', ') || 'none'}.`
            : `${matches.length} ${role}s named "${name}" are on screen, so which one is meant is unclear.`);
    }

    elementOf(node: IScreenNode): IPageElement {
        const element = this.elementByNode.get(node);
        if ( !element ) { throw new Error(`The ${node.role} "${node.name}" is not from this screen.`); }
        return element;
    }

    // THE SCREEN AS LINES, INDENTED BY DEPTH: WHAT A FAILURE PRINTS SO THE READER SEES WHAT WAS THERE
    lines(within?: IScreenNode): string[] {
        const lines: string[] = [];
        const visit = (node: IScreenNode, depth: number) => {
            const valuePart = node.value !== undefined ? ` = "${node.value}"` : '';
            const statePart = node.states.length > 0 ? ` [${node.states.join(', ')}]` : '';
            lines.push(`${'  '.repeat(depth)}${node.role} "${node.name}"${valuePart}${statePart}`);
            node.children.forEach(child => visit(child, depth + 1));
        };
        (within ? [within] : this.roots).forEach(node => visit(node, 0));
        return lines;
    }

}

class RecipeCockpitScreenSubtree {
    constructor(private readonly root: IScreenNode) {}
    all(): IScreenNode[] {
        const nodes: IScreenNode[] = [];
        const visit = (node: IScreenNode) => { nodes.push(node); node.children.forEach(visit); };
        visit(this.root);
        return nodes;
    }
}
