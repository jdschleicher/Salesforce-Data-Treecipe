import * as path from 'path';

jest.mock('vscode', () => ({}), { virtual: true });

import {
    RecipeCockpitService,
    IRecipeCockpitObjectViewModel,
    IRecipeCockpitRecipeViewModel,
    RECIPE_COCKPIT_AUTO_EXPAND_OBJECT_LIMIT,
    RECIPE_COCKPIT_NO_RECORD_TYPE_FIELDS_NOTE,
    RECIPE_COCKPIT_PANEL_PLACE_VERSION,
    RECIPE_COCKPIT_RECORD_TYPE_FIELDS_ONLY_LABEL
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';

/*
    "Record type fields only" (#320): each card's Treecipe tab narrows its rows to the fields its
    record types restrict, and every such row names those record types in a chip. Both are drawn
    in the panel from objects[].recordTypes[].impacts, which the model already carries. In the tree
    workspace, Account has Business and Partner, both restricting Rating__c; Contact and
    OtherChildObject__c have no record types, and the Lead-ONLY card has none at all.
*/

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const TREE_GENERATED_RECIPES_PATH = path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes');
const CURRENT_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';

const loadRecipe = (): IRecipeCockpitRecipeViewModel => RecipeCockpitService.loadRecipeRunByRuns(
    RecipeCockpitService.findGeneratedRecipeRuns(TREE_GENERATED_RECIPES_PATH),
    TREE_WORKSPACE_ROOT,
    CURRENT_RUN_FOLDER_NAME
).recipeViewModel;

const objectOf = (recipe: IRecipeCockpitRecipeViewModel, objectApiName: string) => recipe.objects.find(objectViewModel => objectViewModel.objectApiName === objectApiName) as IRecipeCockpitObjectViewModel;

type Panel = ReturnType<typeof runPanelScript>;

const drawRecipe = (recipeChanges: (recipe: IRecipeCockpitRecipeViewModel) => void = () => undefined, savedState?: any): Panel => {
    const panel = runPanelScript(savedState ? { savedState } : {});
    const recipe = loadRecipe();
    recipeChanges(recipe);
    panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 3 });
    panel.expandAllTrees();
    return panel;
};

const accountCardOf = (panel: Panel) => panel.treeCards()[0];
const leadCardOf = (panel: Panel) => panel.treeCards()[1];
const checkOf = (panel: Panel, treeCard: any) => panel.findAll(panel.tabPanelOf(treeCard, 'treeStructure'), 'treeRecordTypeFieldsToggle')[0];
const matchCountOf = (panel: Panel, treeCard: any) => panel.findAll(panel.tabPanelOf(treeCard, 'treeStructure'), 'tabMatchCount')[0].textContent;
const cardObjectsOf = (panel: Panel, treeCard: any) => panel.objectElements().filter((objectElement: any) => panel.findAll(treeCard, 'treeObject').indexOf(objectElement) !== -1);
const objectNamed = (panel: Panel, treeCard: any, objectApiName: string) => cardObjectsOf(panel, treeCard).find((objectElement: any) => panel.objectNameOf(objectElement) === objectApiName);
const chipOf = (panel: Panel, objectElement: any, fieldApiName: string) => panel.findAll(panel.fieldRowNamed(objectElement, fieldApiName), 'recordTypeChip')[0];
const allChipsOf = (panel: Panel, objectElement: any) => panel.findAll(panel.objectBodyOf(objectElement), 'recordTypeChip');
const isObjectExpanded = (panel: Panel, objectElement: any) => !panel.isHidden(panel.objectBodyOf(objectElement));

const addImpact = (recipe: IRecipeCockpitRecipeViewModel, developerName: string, impact: unknown) => {
    const recordType = objectOf(recipe, 'Account').recordTypes?.find(candidate => candidate.developerName === developerName);
    (recordType?.impacts as unknown[]).push(impact);
};

describe('RecipeCockpitService, "Record type fields only" and the record type chip (#320)', () => {

    describe('the check', () => {

        // #343: THE SAME treeFieldInclude BOX EVERY OTHER CHECKBOX DRAWS, ITS LABEL BESIDE IT
        it('sits in the filter tile under the Treecipe tab\'s search box, off by default, as the cockpit\'s own checkbox box with its label (#490)', () => {

            const panel = drawRecipe();
            const checkElement = checkOf(panel, accountCardOf(panel));
            const wrapperElement = checkElement.parentNode;
            const labelElement = wrapperElement.children[1];

            expect(wrapperElement.classList.contains('treeRecordTypeFieldsCheck')).toBe(true);
            expect(wrapperElement.parentNode.classList.contains('treecipeFilterRow')).toBe(true);
            expect(wrapperElement.parentNode.parentNode.classList.contains('treecipeFilterTile')).toBe(true);
            expect(wrapperElement.parentNode.parentNode.children[0]).toBe(wrapperElement.parentNode);
            expect(panel.findAll(panel.findAll(accountCardOf(panel), 'tabSearch')[0], 'treeRecordTypeFieldsToggle')).toHaveLength(0);
            expect(RECIPE_COCKPIT_RECORD_TYPE_FIELDS_ONLY_LABEL).toBe('Click to show record type impacted fields only');
            expect(checkElement.classList.contains('treeFieldInclude')).toBe(true);
            expect(checkElement.classList.contains('historyAction')).toBe(false);
            expect(checkElement.attributes.role).toBe('checkbox');
            expect(checkElement.attributes['aria-checked']).toBe('false');
            expect(checkElement.textContent).toBe('');
            expect(checkElement.disabled).toBe(false);
            expect(labelElement.classList.contains('treeRecordTypeFieldsLabel')).toBe(true);
            expect(labelElement.textContent).toBe(RECIPE_COCKPIT_RECORD_TYPE_FIELDS_ONLY_LABEL);
            expect(wrapperElement.textContent).not.toMatch(/[☐☑]/);

            labelElement.dispatch('click');
            expect(checkElement.attributes['aria-checked']).toBe('true');
            expect(checkElement.textContent).toBe('✓');

        });

        it('hides fields no record type restricts, expands the objects that have one and labels the ones that do not', () => {

            const panel = drawRecipe();
            const accountCard = accountCardOf(panel);

            checkOf(panel, accountCard).dispatch('click');

            const account = objectNamed(panel, accountCard, 'Account');
            const contact = objectNamed(panel, accountCard, 'Contact');
            const otherChild = objectNamed(panel, accountCard, 'OtherChildObject__c');

            expect(checkOf(panel, accountCard).attributes['aria-checked']).toBe('true');
            expect(checkOf(panel, accountCard).textContent).toBe('✓');
            expect(isObjectExpanded(panel, account)).toBe(true);
            expect(panel.visibleFieldNamesOf(account)).toEqual(['Rating__c']);
            expect(panel.objectCountOf(account)).toBe('1 of 8 fields');
            [contact, otherChild].forEach(objectElement => {
                expect(objectElement).toBeDefined();
                expect(isObjectExpanded(panel, objectElement)).toBe(false);
                expect(panel.objectCountOf(objectElement)).toBe('no record type fields');
            });
            expect(matchCountOf(panel, accountCard)).toBe('1 of 13 fields');

        });

        it('gives back every row, and what the reader had opened, when it is turned off', () => {

            const panel = drawRecipe();
            const accountCard = accountCardOf(panel);
            const contact = objectNamed(panel, accountCard, 'Contact');
            panel.expandObject(contact);

            checkOf(panel, accountCard).dispatch('click');
            expect(isObjectExpanded(panel, contact)).toBe(false);

            checkOf(panel, accountCard).dispatch('click');

            const account = objectNamed(panel, accountCard, 'Account');
            expect(checkOf(panel, accountCard).attributes['aria-checked']).toBe('false');
            expect(isObjectExpanded(panel, contact)).toBe(true);
            expect(isObjectExpanded(panel, account)).toBe(false);
            expect(panel.visibleFieldNamesOf(account)).toHaveLength(8);
            expect(panel.objectCountOf(contact)).toBe('2 fields');
            expect(matchCountOf(panel, accountCard)).toBe('13 fields');

        });

        it('combines with the search box: a field shows only when it passes both, and clearing either updates at once', () => {

            const panel = drawRecipe(recipe => addImpact(recipe, 'Partner', { fieldApiName: 'Regions__c', kind: 'multiselect', valueCount: 2 }));
            const accountCard = accountCardOf(panel);
            const account = objectNamed(panel, accountCard, 'Account');
            const contact = objectNamed(panel, accountCard, 'Contact');

            checkOf(panel, accountCard).dispatch('click');
            expect(panel.visibleFieldNamesOf(account)).toEqual(['Rating__c', 'Regions__c']);

            panel.typeIntoFilter('regions', accountCard);
            expect(panel.visibleFieldNamesOf(account)).toEqual(['Regions__c']);
            expect(matchCountOf(panel, accountCard)).toBe('1 of 13 fields');

            panel.typeIntoFilter('lastname', accountCard);
            expect(panel.visibleFieldNamesOf(account)).toEqual([]);
            expect(panel.objectCountOf(account)).toBe('no matching fields');
            expect(panel.objectCountOf(contact)).toBe('no record type fields');
            expect(matchCountOf(panel, accountCard)).toBe('no matches');

            panel.typeIntoFilter('', accountCard);
            expect(panel.visibleFieldNamesOf(account)).toEqual(['Rating__c', 'Regions__c']);

            panel.typeIntoFilter('regions', accountCard);
            checkOf(panel, accountCard).dispatch('click');
            expect(panel.visibleFieldNamesOf(account)).toEqual(['Regions__c']);

            panel.typeIntoFilter('lastname', accountCard);
            expect(panel.visibleFieldNamesOf(contact)).toEqual(['LastName']);

        });

        it('names the object when the search matches it, and still leaves only its record type fields', () => {

            const panel = drawRecipe();
            const accountCard = accountCardOf(panel);
            const account = objectNamed(panel, accountCard, 'Account');

            checkOf(panel, accountCard).dispatch('click');
            panel.typeIntoFilter('account', accountCard);

            expect(panel.visibleFieldNamesOf(account)).toEqual(['Rating__c']);
            expect(panel.objectCountOf(account)).toBe('1 of 8 fields');

        });

        it('belongs to its own card only', () => {

            const panel = drawRecipe(recipe => {
                const leadTree = recipe.trees.find(tree => tree.treeKey === 'Lead-ONLY');
                leadTree?.objects.push({ objectApiName: 'Account', parentLookups: [] });
            });

            checkOf(panel, accountCardOf(panel)).dispatch('click');

            const leadAccount = objectNamed(panel, leadCardOf(panel), 'Account');
            expect(checkOf(panel, leadCardOf(panel)).attributes['aria-checked']).toBe('false');
            expect(panel.visibleFieldNamesOf(leadAccount)).toHaveLength(0);
            panel.expandObject(leadAccount);
            expect(panel.visibleFieldNamesOf(leadAccount)).toHaveLength(8);

        });

        it('keeps the existing auto-expand limit, leaving the objects past it collapsed with their count', () => {

            const objectCount = RECIPE_COCKPIT_AUTO_EXPAND_OBJECT_LIMIT + 2;

            const panel = drawRecipe(recipe => {
                const account = objectOf(recipe, 'Account');
                const accountTree = recipe.trees.find(tree => tree.treeKey === ACCOUNT_TREE_KEY);
                for (let objectIndex = 0; objectIndex < objectCount; objectIndex++) {
                    const objectApiName = `Copy${objectIndex}__c`;
                    recipe.objects.push({ ...account, objectApiName: objectApiName });
                    accountTree?.objects.push({ objectApiName: objectApiName, parentLookups: [] });
                }
            });

            checkOf(panel, accountCardOf(panel)).dispatch('click');

            const copies = cardObjectsOf(panel, accountCardOf(panel)).filter((objectElement: any) => /^Copy/.test(panel.objectNameOf(objectElement)));
            const expandedCount = cardObjectsOf(panel, accountCardOf(panel)).filter((objectElement: any) => isObjectExpanded(panel, objectElement)).length;

            expect(expandedCount).toBe(RECIPE_COCKPIT_AUTO_EXPAND_OBJECT_LIMIT);
            expect(isObjectExpanded(panel, copies[copies.length - 1])).toBe(false);
            expect(panel.objectCountOf(copies[copies.length - 1])).toBe('1 of 8 fields');

        });

    });

    describe('a card with no record types', () => {

        it('draws the check disabled, with a note saying why, and a click changes nothing', () => {

            const panel = drawRecipe();
            const leadCard = leadCardOf(panel);
            const checkElement = checkOf(panel, leadCard);
            const noteElements = panel.findAll(panel.tabPanelOf(leadCard, 'treeStructure'), 'treeRecordTypeFieldsNote');

            expect(checkElement.disabled).toBe(true);
            expect(checkElement.attributes['aria-checked']).toBe('false');
            expect(checkElement.attributes.title).toBe(RECIPE_COCKPIT_NO_RECORD_TYPE_FIELDS_NOTE);
            expect(noteElements.map((noteElement: any) => noteElement.textContent)).toEqual([RECIPE_COCKPIT_NO_RECORD_TYPE_FIELDS_NOTE]);
            expect(RECIPE_COCKPIT_NO_RECORD_TYPE_FIELDS_NOTE).toBe('No object in this tree has more than one record type, so no field depends on one.');

            checkElement.dispatch('click');
            checkElement.parentNode.children[1].dispatch('click');
            expect(checkElement.attributes['aria-checked']).toBe('false');
            expect(checkElement.parentNode.classList.contains('disabled')).toBe(true);
            expect(matchCountOf(panel, leadCard)).toBe('2 fields');

        });

        it('draws no note on a card that has record types', () => {

            const panel = drawRecipe();

            expect(panel.findAll(accountCardOf(panel), 'treeRecordTypeFieldsNote')).toHaveLength(0);

        });

    });

    describe('the row chip', () => {

        it('names the record types restricting a field, whether or not the check is on', () => {

            const panel = drawRecipe();
            const account = objectNamed(panel, accountCardOf(panel), 'Account');
            panel.expandObject(account);

            expect(chipOf(panel, account, 'Rating__c').textContent).toBe('Business, Partner');
            expect(chipOf(panel, account, 'Rating__c').attributes.title).toBe('Restricted by record types Business, Partner');
            expect(allChipsOf(panel, account)).toHaveLength(1);

            checkOf(panel, accountCardOf(panel)).dispatch('click');
            expect(chipOf(panel, account, 'Rating__c').textContent).toBe('Business, Partner');

        });

        it('lists record types in the order the Record types section does, each once, and one alone in the singular', () => {

            const panel = drawRecipe(recipe => {
                const account = objectOf(recipe, 'Account');
                account.recordTypes = account.recordTypes?.slice().reverse();
                addImpact(recipe, 'Partner', { fieldApiName: 'Rating__c', kind: 'picklist', valueCount: 1 });
                addImpact(recipe, 'Business', { fieldApiName: 'Sub_Rating__c', kind: 'dependent', valueCount: 1 });
            });
            const account = objectNamed(panel, accountCardOf(panel), 'Account');
            panel.expandObject(account);

            expect(chipOf(panel, account, 'Rating__c').textContent).toBe('Partner, Business');
            expect(chipOf(panel, account, 'Sub_Rating__c').textContent).toBe('Business');
            expect(chipOf(panel, account, 'Sub_Rating__c').attributes.title).toBe('Restricted by record type Business');

        });

        it('draws no chip on a field nothing restricts', () => {

            const panel = drawRecipe();
            const account = objectNamed(panel, accountCardOf(panel), 'Account');
            panel.expandObject(account);

            ['Name', 'Regions__c', 'Sub_Rating__c'].forEach(fieldApiName => expect(chipOf(panel, account, fieldApiName)).toBeUndefined());

        });

        it('draws the same chips on a later occurrence of the object', () => {

            const panel = drawRecipe(recipe => {
                const account = objectOf(recipe, 'Account');
                account.nickname = 'Account_NickName';
                account.iterations = [{
                    nickname: 'Account_child_NickName',
                    lineNumber: 40,
                    parentObjectApiName: 'Account',
                    parentNickname: 'Account_NickName',
                    fields: [{ fieldApiName: 'Rating__c', lineNumber: 42, recipeValue: 'x' }]
                }] as any;
                recipe.trees.find(tree => tree.treeKey === ACCOUNT_TREE_KEY)?.objects.splice(1, 0, { objectApiName: 'Account', parentLookups: [], iterationNickname: 'Account_child_NickName' } as any);
            });
            const iteration = cardObjectsOf(panel, accountCardOf(panel))[1];
            panel.expandObject(iteration);

            expect(chipOf(panel, iteration, 'Rating__c').textContent).toBe('Business, Partner');

        });

        it('uses the palette\'s chip pair, already held to 4.5:1 by the contrast test, so it adds no colour pair', () => {

            const shellHtml = RecipeCockpitService.buildWebviewShellHtml('testNonce');
            const chipRule = shellHtml.match(/\.recordTypeChip \{[^}]*\}/)?.[0] as string;

            expect(chipRule).toContain('color: var(--sdt-chip-text);');
            expect(chipRule).toContain('background-color: var(--sdt-chip-bg);');
            expect(chipRule).toContain('border: 1px dashed var(--sdt-chip-text);');
            // THE CHECK IS A treeFieldInclude BOX (#343), AND THE NOTE IS muted: BOTH ALREADY IN THE CONTRAST TEST'S PAIRS
            expect(shellHtml).toContain("createButton('check', 'treeFieldInclude treeRecordTypeFieldsToggle')");
            expect(shellHtml).toContain("createElement('span', 'treeRecordTypeFieldsNote muted', NO_RECORD_TYPE_FIELDS_NOTE)");

        });

    });

    describe('unhappy paths add no chip', () => {

        it('ignores an impact naming a field the object does not list, one that is not an object, and __proto__', () => {

            const panel = drawRecipe(recipe => {
                [
                    { fieldApiName: 'Missing__c', kind: 'picklist', valueCount: 1 },
                    { fieldApiName: 'constructor', kind: 'picklist', valueCount: 1 },
                    { fieldApiName: '__proto__', kind: 'picklist', valueCount: 1 },
                    { fieldApiName: 7, kind: 'picklist', valueCount: 1 },
                    null,
                    'Name',
                    ['Name'],
                    42
                ].forEach(impact => addImpact(recipe, 'Business', impact));
                objectOf(recipe, 'Account').fields.push({ ...objectOf(recipe, 'Account').fields[0], fieldApiName: '__proto__', lineNumber: undefined });
            });
            const account = objectNamed(panel, accountCardOf(panel), 'Account');
            panel.expandObject(account);

            expect(allChipsOf(panel, account).map((chipElement: any) => chipElement.textContent)).toEqual(['Business, Partner']);
            expect(chipOf(panel, account, '__proto__')).toBeUndefined();

            checkOf(panel, accountCardOf(panel)).dispatch('click');
            expect(panel.visibleFieldNamesOf(account)).toEqual(['Rating__c']);

        });

        it('ignores a record type that is not an object or carries no impacts list', () => {

            const panel = drawRecipe(recipe => {
                const account = objectOf(recipe, 'Account');
                (account.recordTypes as unknown[]).push(null, 'Retail', { developerName: 'Retail', isActive: true, impacts: 'Rating__c' }, { developerName: 9, isActive: true, impacts: [{ fieldApiName: 'Name', kind: 'picklist', valueCount: 1 }] });
            });
            const account = objectNamed(panel, accountCardOf(panel), 'Account');
            panel.expandObject(account);

            expect(allChipsOf(panel, account).map((chipElement: any) => chipElement.textContent)).toEqual(['Business, Partner']);

        });

        it('draws an object named __proto__ with no chip, and counts it as having no record types', () => {

            const panel = drawRecipe(recipe => {
                const account = objectOf(recipe, 'Account');
                recipe.objects.push({ ...account, objectApiName: '__proto__' });
                recipe.trees.find(tree => tree.treeKey === ACCOUNT_TREE_KEY)?.objects.push({ objectApiName: '__proto__', parentLookups: [] });
            });
            const protoObject = objectNamed(panel, accountCardOf(panel), '__proto__');

            expect(protoObject).toBeDefined();
            panel.expandObject(protoObject);
            expect(allChipsOf(panel, protoObject)).toHaveLength(0);

            checkOf(panel, accountCardOf(panel)).dispatch('click');
            expect(panel.objectCountOf(protoObject)).toBe('no record type fields');

        });

        it('draws the check disabled when the only object with record types lists one', () => {

            const panel = drawRecipe(recipe => {
                const account = objectOf(recipe, 'Account');
                account.recordTypes = account.recordTypes?.slice(0, 1);
            });
            const account = objectNamed(panel, accountCardOf(panel), 'Account');
            panel.expandObject(account);

            expect(checkOf(panel, accountCardOf(panel)).disabled).toBe(true);
            expect(allChipsOf(panel, account)).toHaveLength(0);

        });

    });

    describe('the saved place', () => {

        const savedTreeOf = (panel: Panel) => panel.savedState().trees.find((savedTree: any) => savedTree.treeKey === ACCOUNT_TREE_KEY);

        const savedPlaceWith = (treePlace: Record<string, unknown>) => ({
            version: RECIPE_COCKPIT_PANEL_PLACE_VERSION,
            runFolderName: CURRENT_RUN_FOLDER_NAME,
            isOrgPickerInUse: false,
            isFavoritesOnly: false,
            scrollY: 0,
            trees: [{ treeKey: ACCOUNT_TREE_KEY, isExpanded: true, selectedTab: 'treecipe', searchQueries: { treecipe: '', datasets: '' }, expandedObjectKeys: [], openPicklistKeys: [], ...treePlace }]
        });

        it('saves the check as an optional field of the card, and drops it once it is off', () => {

            const panel = drawRecipe();

            checkOf(panel, accountCardOf(panel)).dispatch('click');
            expect(panel.savedState().version).toBe(RECIPE_COCKPIT_PANEL_PLACE_VERSION);
            expect(savedTreeOf(panel).isRecordTypeFieldsOnly).toBe(true);

            checkOf(panel, accountCardOf(panel)).dispatch('click');
            // A CARD BACK AT ITS DEFAULT IS NOT WRITTEN AT ALL (#374)
            expect(savedTreeOf(panel) ?? {}).not.toHaveProperty('isRecordTypeFieldsOnly');

        });

        it('restores the check and its filter in the next document', () => {

            const firstPanel = drawRecipe();
            checkOf(firstPanel, accountCardOf(firstPanel)).dispatch('click');

            const panel = runPanelScript({ savedState: firstPanel.savedState() });
            panel.postToPanel({ command: 'recipeData', recipe: loadRecipe(), renderSequence: 3 });

            const account = objectNamed(panel, accountCardOf(panel), 'Account');
            expect(checkOf(panel, accountCardOf(panel)).attributes['aria-checked']).toBe('true');
            expect(panel.visibleFieldNamesOf(account)).toEqual(['Rating__c']);
            expect(panel.objectCountOf(objectNamed(panel, accountCardOf(panel), 'Contact'))).toBe('no record type fields');

        });

        it('restores a check saved on a card that is still collapsed once the card is opened', () => {

            const panel = runPanelScript({ savedState: savedPlaceWith({ isExpanded: false, isRecordTypeFieldsOnly: true }) });
            panel.postToPanel({ command: 'recipeData', recipe: loadRecipe(), renderSequence: 3 });
            panel.chooseTreeCard(accountCardOf(panel));

            expect(checkOf(panel, accountCardOf(panel)).attributes['aria-checked']).toBe('true');
            expect(panel.visibleFieldNamesOf(objectNamed(panel, accountCardOf(panel), 'Account'))).toEqual(['Rating__c']);

        });

        it('loads an older place, which has no such field, with the check off', () => {

            const panel = runPanelScript({ savedState: savedPlaceWith({}) });
            panel.postToPanel({ command: 'recipeData', recipe: loadRecipe(), renderSequence: 3 });

            expect(checkOf(panel, accountCardOf(panel)).attributes['aria-checked']).toBe('false');
            expect(matchCountOf(panel, accountCardOf(panel))).toBe('13 fields');

        });

        it('keeps the field through normalizePanelPlace only when it is true, so workspaceState holds no other value', () => {

            const normalizedTree = (isRecordTypeFieldsOnly: unknown) => RecipeCockpitService.normalizePanelPlace(savedPlaceWith({ isRecordTypeFieldsOnly }))?.trees[0];

            expect(normalizedTree(true)?.isRecordTypeFieldsOnly).toBe(true);
            [false, 'true', 1, null, undefined].forEach(candidateValue => expect(normalizedTree(candidateValue)).not.toHaveProperty('isRecordTypeFieldsOnly'));

        });

    });

    describe('no new host data', () => {

        it('adds nothing to the model: no field carries record type names, and the impacts are what #195 posted', () => {

            const recipe = loadRecipe();

            recipe.objects.forEach(objectViewModel => objectViewModel.fields.forEach(field => {
                expect(Object.keys(field).filter(fieldKey => /recordType/i.test(fieldKey))).toEqual([]);
            }));
            expect(objectOf(recipe, 'Account').recordTypes?.map(recordType => Object.keys(recordType).sort())).toEqual([
                ['developerName', 'impacts', 'isActive'],
                ['developerName', 'impacts', 'isActive']
            ]);
            expect(RecipeCockpitService.buildWebviewShellHtml('testNonce')).not.toMatch(/command: 'recordTypeFields/);

        });

        it('asks the host for nothing when the check is used: it posts only the reader\'s place', () => {

            const panel = drawRecipe();
            const postedBefore = panel.postedHostMessages.length;

            checkOf(panel, accountCardOf(panel)).dispatch('click');
            panel.typeIntoFilter('rating', accountCardOf(panel));
            checkOf(panel, accountCardOf(panel)).dispatch('click');

            const postedCommands = panel.postedHostMessages.slice(postedBefore).map((hostMessage: any) => hostMessage.command);
            expect(postedCommands.length).toBeGreaterThan(0);
            expect(new Set(postedCommands)).toEqual(new Set(['savePlace']));

        });

    });

});
