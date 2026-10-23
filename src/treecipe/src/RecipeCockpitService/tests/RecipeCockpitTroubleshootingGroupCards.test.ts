import * as path from 'path';

jest.mock('vscode', () => ({}), { virtual: true });

import {
    RecipeCockpitService,
    IRecipeCockpitObjectViewModel,
    IRecipeCockpitRecipeViewModel,
    RECIPE_COCKPIT_ACTION_CARD_HEIGHT,
    RECIPE_COCKPIT_ACTION_CARD_WIDTH,
    RECIPE_COCKPIT_ACTION_VERB_EMOJI,
    RECIPE_COCKPIT_OBJECT_NO_VALIDATION_RULES_NOTE,
    RECIPE_COCKPIT_TROUBLESHOOTING_GROUP_EMOJI
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';

/*
    The TODO's and Validation Rules lists draw each object group as a card (#383), on #381's card
    surface: the header is ONE card button that opens the group, a closed card keeps the card's
    fixed height, an open one spans the grid and grows. Nothing about the groups' behaviour moves.
*/

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const TREE_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const VALIDATION_RULE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'validationRuleWorkspace');
const VALIDATION_RULE_RUN_FOLDER_NAME = 'recipe-fakerjs-2026-10-01T09-00-00';
const GADGET_TREE_KEY = 'Gadget__c-thru-Widget__c';

type Panel = ReturnType<typeof runPanelScript>;

const loadRecipe = (workspaceRoot: string, runFolderName: string): IRecipeCockpitRecipeViewModel => RecipeCockpitService.loadRecipeRunByRuns(
    RecipeCockpitService.findGeneratedRecipeRuns(path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes')),
    workspaceRoot,
    runFolderName
).recipeViewModel;

const loadTreeRecipe = () => loadRecipe(TREE_WORKSPACE_ROOT, TREE_RUN_FOLDER_NAME);
const objectOf = (recipe: IRecipeCockpitRecipeViewModel, objectApiName: string) => recipe.objects.find(objectViewModel => objectViewModel.objectApiName === objectApiName) as IRecipeCockpitObjectViewModel;

const drawRecipe = (recipe: IRecipeCockpitRecipeViewModel): Panel => {
    const panel = runPanelScript({});
    panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 3 });
    panel.postToPanel({ command: 'rendered' });
    panel.expandAllTrees();
    return panel;
};

const styleSheet = () => {
    const html = RecipeCockpitService.buildWebviewShellHtml('testNonce');
    return html.substring(html.indexOf('<style nonce="testNonce">'), html.indexOf('</style>'));
};
const ruleFor = (selector: string) => {
    const match = styleSheet().match(new RegExp('\\n\\s*' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}'));
    return match ? match[1] : '';
};

const countElements = (element: any): number => 1 + element.children.reduce((count: number, childElement: any) => count + countElements(childElement), 0);
const headerOf = (panel: Panel, groupElement: any) => panel.findAll(groupElement, 'troubleshootingGroupCardHeader')[0];
const buttonKindsOf = (element: any) => String(element.className).split(' ').filter((className: string) => className.startsWith('sdtButton-'));

const openTodos = (panel: Panel) => {
    const accountCard = panel.treeCards()[0];
    panel.openTab(accountCard, 'Troubleshooting');
    return panel.findAll(accountCard, 'troubleshootingSubPanel-todos')[0];
};

const openValidationRules = (panel: Panel, objects: unknown[]) => {
    const gadgetCard = panel.treeCards()[0];
    panel.openTab(gadgetCard, 'Troubleshooting');
    panel.findAll(gadgetCard, 'troubleshootingSubTab').find((tabElement: any) => tabElement.textContent === 'Validation Rules').dispatch('click');
    panel.postToPanel({ command: 'treeValidationRules', renderSequence: 3, treeKey: GADGET_TREE_KEY, objects: objects });
    return panel.findAll(gadgetCard, 'troubleshootingSubPanel-validationRules')[0];
};

const rule = (ruleName: string, status: string) => ({ ruleName: ruleName, status: status, isActive: status !== 'inactive', fieldApiNames: [], reasons: [] });

describe('RecipeCockpitService, the Troubleshooting tab\'s group cards (#383)', () => {

    it('names one emoji per kind of group, none of them a verb\'s', () => {

        expect(RECIPE_COCKPIT_TROUBLESHOOTING_GROUP_EMOJI).toEqual({ todos: '📝', validationRules: '📏' });
        Object.values(RECIPE_COCKPIT_TROUBLESHOOTING_GROUP_EMOJI).forEach(emoji => expect(Object.values(RECIPE_COCKPIT_ACTION_VERB_EMOJI)).not.toContain(emoji));

    });

    describe('the TODO\'s groups', () => {

        it('draws each object group as a card in a grid, its header the one card button that toggles it', () => {

            const panel = drawRecipe(loadTreeRecipe());
            const todosPanel = openTodos(panel);

            const grid = panel.findAll(todosPanel, 'troubleshootingGroupCards')[0];
            const groups = panel.findAll(todosPanel, 'troubleshootingTodoGroup');
            expect(groups).toHaveLength(3);
            expect(groups.every((groupElement: any) => groupElement.parentNode === grid && groupElement.classList.contains('troubleshootingGroupCard'))).toBe(true);

            const contactHeader = headerOf(panel, groups[1]);
            expect(contactHeader.tagName).toBe('button');
            expect(buttonKindsOf(contactHeader)).toEqual(['sdtButton-card']);
            expect(contactHeader.classList.contains('troubleshootingTodoToggle')).toBe(true);
            expect(panel.findAll(groups[1], 'sdtButton-card')).toEqual([contactHeader]);
            expect(panel.findAll(contactHeader, 'sdtButton')).toEqual([contactHeader]);

            const emojiElement = panel.findAll(contactHeader, 'actionCardEmoji')[0];
            expect(emojiElement.textContent).toBe('📝');
            expect(emojiElement.attributes['aria-hidden']).toBe('true');
            expect(panel.findAll(contactHeader, 'troubleshootingTodoObject')[0].textContent).toBe('Contact');
            expect(panel.findAll(contactHeader, 'troubleshootingTodoCount')[0].textContent).toBe('1 TODO');

            // THE GROUPS OPEN WITHIN THE BUDGETS, AS BEFORE; A CLICK ON A HEADER CLOSES AND OPENS ITS CARD
            expect(groups.map((groupElement: any) => headerOf(panel, groupElement).attributes['aria-expanded'])).toEqual(['true', 'true', 'true']);
            expect(groups.every((groupElement: any) => groupElement.classList.contains('expanded'))).toBe(true);

            contactHeader.dispatch('click');
            expect(contactHeader.attributes['aria-expanded']).toBe('false');
            expect(groups[1].classList.contains('expanded')).toBe(false);
            expect(panel.isHidden(panel.findAll(groups[1], 'troubleshootingTodoRows')[0])).toBe(true);

            contactHeader.dispatch('click');
            expect(contactHeader.attributes['aria-expanded']).toBe('true');
            expect(groups[1].classList.contains('expanded')).toBe(true);
            expect(panel.findAll(groups[1], 'troubleshootingTodo')).toHaveLength(1);

        });

        it('adds a constant number of elements per group, whatever its TODO count, and none until it opens', () => {

            const closedGroupElementCount = (todoCount: number) => {
                const recipe = loadTreeRecipe();
                objectOf(recipe, 'Account').todos = Array.from({ length: 3000 }, (_, todoIndex) => ({ lineNumber: 1000 + todoIndex, text: `### TODO ${todoIndex}` }));
                objectOf(recipe, 'Contact').todos = Array.from({ length: todoCount }, (_, todoIndex) => ({ lineNumber: 9000 + todoIndex, text: `### TODO ${todoIndex}` }));
                const panel = drawRecipe(recipe);
                const contactGroup = panel.findAll(openTodos(panel), 'troubleshootingTodoGroup')[1];
                expect(headerOf(panel, contactGroup).attributes['aria-expanded']).toBe('false');
                return countElements(contactGroup);
            };

            // A CARD, ITS HEADER BUTTON, THE HEADING, THE EMOJI, THE OBJECT, THE COUNT AND THE UNBUILT BODY
            expect(closedGroupElementCount(10)).toBe(7);
            expect(closedGroupElementCount(5000)).toBe(7);

        });

        it('draws a removed TODO\'s group as the same card, open, with a header that is text', () => {

            const recipe = loadTreeRecipe();
            recipe.trees[0].removedTodos = [{ removalKey: '0', objectApiName: 'Account', fieldApiName: 'Phone', text: '### TODO -- mine' } as any];

            const panel = drawRecipe(recipe);
            const removedPanel = panel.findAll(openTodos(panel), 'todosViewPanel-removed')[0];
            const removedGroup = panel.findAll(removedPanel, 'troubleshootingTodoGroup')[0];

            expect(removedGroup.classList.contains('troubleshootingGroupCard')).toBe(true);
            expect(removedGroup.classList.contains('expanded')).toBe(true);
            expect(removedGroup.parentNode.classList.contains('troubleshootingGroupCards')).toBe(true);
            expect(headerOf(panel, removedGroup).tagName).toBe('div');
            expect(panel.findAll(removedGroup, 'actionCardEmoji')[0].textContent).toBe('📝');
            expect(panel.findAll(panel.findAll(removedGroup, 'troubleshootingTodoRows')[0], 'troubleshootingTodoRestore')).toHaveLength(1);

        });

    });

    describe('the Validation Rules groups', () => {

        it('draws each object as a card whose header shows 📏, the object, the count and one line of how many rules are in each status', () => {

            const panel = drawRecipe(loadRecipe(VALIDATION_RULE_WORKSPACE_ROOT, VALIDATION_RULE_RUN_FOLDER_NAME));
            const subPanel = openValidationRules(panel, [
                { objectApiName: 'Gadget__c', rules: [rule('Inactive_One', 'inactive'), rule('Applied_One', 'applied'), rule('Not_Applied_One', 'notApplied'), rule('Applied_Two', 'applied')] },
                { objectApiName: 'Widget__c', rules: [] }
            ]);

            const grid = panel.findAll(subPanel, 'validationRuleList')[0];
            expect(grid.classList.contains('troubleshootingGroupCards')).toBe(true);
            const groups = panel.findAll(subPanel, 'validationRuleObject');
            expect(groups.every((groupElement: any) => groupElement.classList.contains('troubleshootingGroupCard'))).toBe(true);

            const gadgetHeader = headerOf(panel, groups[0]);
            expect(gadgetHeader.tagName).toBe('button');
            expect(buttonKindsOf(gadgetHeader)).toEqual(['sdtButton-card']);
            expect(gadgetHeader.classList.contains('validationRuleToggle')).toBe(true);
            expect(panel.findAll(gadgetHeader, 'actionCardEmoji')[0].textContent).toBe('📏');
            expect(panel.findAll(gadgetHeader, 'validationRuleObjectName')[0].textContent).toBe('Gadget__c');
            expect(panel.findAll(gadgetHeader, 'validationRuleCount')[0].textContent).toBe('4 rules');
            expect(panel.findAll(gadgetHeader, 'validationRuleDetail')[0].textContent).toBe('2 applied · 1 not applied · 1 inactive');

            // OPENED WITHIN THE BUDGETS AS BEFORE, AND CLOSED BY ITS HEADER
            expect(gadgetHeader.attributes['aria-expanded']).toBe('true');
            gadgetHeader.dispatch('click');
            expect(gadgetHeader.attributes['aria-expanded']).toBe('false');
            expect(groups[0].classList.contains('expanded')).toBe(false);

            // AN OBJECT WITH NO RULE HAS NOTHING TO OPEN: THE SAME CARD, ITS HEADER TEXT, ITS NOTE UNDER IT
            const widgetHeader = headerOf(panel, groups[1]);
            expect(widgetHeader.tagName).toBe('div');
            expect(widgetHeader.attributes['aria-expanded']).toBeUndefined();
            expect(panel.findAll(groups[1], 'validationRuleDetail')).toEqual([]);
            expect(panel.findAll(groups[1], 'validationRuleEmpty')[0].textContent).toBe(RECIPE_COCKPIT_OBJECT_NO_VALIDATION_RULES_NOTE);

        });

        it('counts a status it has no label for under its own name, after the known ones', () => {

            const panel = drawRecipe(loadRecipe(VALIDATION_RULE_WORKSPACE_ROOT, VALIDATION_RULE_RUN_FOLDER_NAME));
            const subPanel = openValidationRules(panel, [
                { objectApiName: 'Gadget__c', rules: [rule('Odd', 'somethingNew'), rule('Gone', 'notInRun'), rule('Bad', 'unreadable')] }
            ]);

            expect(panel.findAll(subPanel, 'validationRuleDetail')[0].textContent).toBe('1 not in this run · 1 unreadable · 1 somethingnew');

        });

    });

    describe('the stylesheet', () => {

        it('puts the group on the action cards\' surface, border and radius, closed at the card height, open across the grid', () => {

            const cardRule = ruleFor('.troubleshootingGroupCard');
            expect(cardRule).toContain(`min-height: ${RECIPE_COCKPIT_ACTION_CARD_HEIGHT};`);
            expect(cardRule).toContain('background-color: var(--sdt-surface);');
            expect(cardRule).toContain('border: 1px solid var(--sdt-border);');
            expect(cardRule).toContain('border-radius: 8px;');
            expect(ruleFor('.sdtButton-card')).toContain('border-radius: 8px;');

            expect(ruleFor('.troubleshootingGroupCards')).toContain(`minmax(min(100%, ${RECIPE_COCKPIT_ACTION_CARD_WIDTH}), 1fr)`);
            expect(ruleFor('.troubleshootingGroupCards')).toContain('align-items: start;');
            expect(ruleFor('.troubleshootingGroupCard.expanded')).toContain('grid-column: 1 / -1;');

            // THE HEADER FILLS A CLOSED CARD AND SHRINKS TO ITS CONTENT IN AN OPEN ONE
            const headerRule = ruleFor('.troubleshootingGroupCard > .troubleshootingGroupCardHeader');
            expect(headerRule).toContain('height: auto;');
            expect(headerRule).toContain('flex: 1 0 auto;');
            expect(ruleFor('.troubleshootingGroupCard.expanded > .troubleshootingGroupCardHeader')).toContain('flex-grow: 0;');

        });

    });

});
