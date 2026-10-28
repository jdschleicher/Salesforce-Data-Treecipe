import * as path from 'path';

jest.mock('vscode', () => ({}), { virtual: true });

import {
    RECIPE_COCKPIT_TODO_IN_VALUE_LABEL,
    RecipeCockpitService,
    IRecipeCockpitObjectViewModel,
    IRecipeCockpitRecipeViewModel,
    RECIPE_COCKPIT_NO_TODOS_NOTE,
    RECIPE_COCKPIT_PANEL_PLACE_VERSION,
    RECIPE_COCKPIT_TODOS_ONLY_LABEL
} from '../RecipeCockpitService';
import { RecipeCockpitRecipeWriter } from '../RecipeCockpitRecipeWriter';
import { runPanelScript } from './RecipeCockpitPanelHarness';

/*
    "TODOs only" (#354): every TODO comment of a card's recipe, found by the one scan the cockpit
    already makes, put on the field whose lines hold it or on the object when it sits on no field,
    and a check on the Treecipe tab that narrows the rows to them. In the tree workspace the
    Account card's recipe has five TODOs, each a field's whole value; the Lead-ONLY card has none.
    The validation rule workspace is the real pipeline's output with each backend, whose rules not
    applied are TODO lines on no field.
*/

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const TREE_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const VALIDATION_RULE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'validationRuleWorkspace');
const SNOWFAKERY_RUN_FOLDER_NAME = 'recipe-2026-10-01T08-00-00';
const FAKERJS_RUN_FOLDER_NAME = 'recipe-fakerjs-2026-10-01T09-00-00';

const loadRun = (workspaceRoot: string, runFolderName: string): IRecipeCockpitRecipeViewModel => RecipeCockpitService.loadRecipeRunByRuns(
    RecipeCockpitService.findGeneratedRecipeRuns(path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes')),
    workspaceRoot,
    runFolderName
).recipeViewModel;

const loadTreeRecipe = () => loadRun(TREE_WORKSPACE_ROOT, TREE_RUN_FOLDER_NAME);

const objectOf = (recipe: IRecipeCockpitRecipeViewModel, objectApiName: string) => recipe.objects.find(objectViewModel => objectViewModel.objectApiName === objectApiName) as IRecipeCockpitObjectViewModel;
const fieldOf = (objectViewModel: IRecipeCockpitObjectViewModel, fieldApiName: string) => objectViewModel.fields.find(field => field.fieldApiName === fieldApiName);
const todoTextsOf = (todos: { text?: string }[] | undefined) => (todos ?? []).map(todo => todo.text);

type Panel = ReturnType<typeof runPanelScript>;

const drawRecipe = (recipe: IRecipeCockpitRecipeViewModel = loadTreeRecipe(), savedState?: any): Panel => {
    const panel = runPanelScript(savedState ? { savedState } : {});
    panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 3 });
    panel.expandAllTrees();
    return panel;
};

const checkOf = (panel: Panel, treeCard: any) => panel.findAll(panel.tabPanelOf(treeCard, 'treeStructure'), 'treeTodosToggle')[0];
const labelOf = (panel: Panel, treeCard: any) => panel.findAll(panel.tabPanelOf(treeCard, 'treeStructure'), 'treeTodosLabel')[0];
const matchCountOf = (panel: Panel, treeCard: any) => panel.findAll(panel.tabPanelOf(treeCard, 'treeStructure'), 'tabMatchCount')[0].textContent;
const objectNamed = (panel: Panel, treeCard: any, objectApiName: string) => panel.findAll(treeCard, 'treeObject').find((objectElement: any) => panel.objectNameOf(objectElement) === objectApiName);
const isObjectExpanded = (panel: Panel, objectElement: any) => !panel.isHidden(panel.objectBodyOf(objectElement));
const todoTextsIn = (panel: Panel, element: any) => panel.findAll(element, 'treeTodoText').map((todoElement: any) => todoElement.textContent);

describe('RecipeCockpitService, the "TODOs only" filter (#354)', () => {

    describe('the scan', () => {

        it('lists every TODO comment of an object\'s own block, generated or hand-written, whole line or after a value', () => {

            const { lines } = RecipeCockpitRecipeWriter.splitRecipeLines([
                '# TODO above every object is no object\'s',
                '- object: Account',
                '  nickname: Account_NickName',
                '  count: 1',
                '  fields:',
                '    Name: ${{fake.Company}}',
                '    ParentId: ### TODO -- REFERENCE ID REQUIRED',
                '    Rating__c: ${{ random_choice(\'Hot\') }}',
                '        ### TODO: -- RecordType Options -- Business -- Below is the faker recipe',
                '        # ${{ random_choice(\'Warm\') }}',
                '    # TODO hand-written',
                '    Notes__c: ${{fake.Word}} # TODO: check the length',
                '    Mention__c: ${{fake.Word}} # not a todo',
                '    Hashtag__c: abc#TODO'
            ].join('\n'));

            const [account] = RecipeCockpitRecipeWriter.scanRecipeObjects(lines);

            expect(account.todoLineIndexes).toEqual([6, 8, 10, 11]);
            expect(account.todoLineIndexes.map(lineIndex => RecipeCockpitRecipeWriter.readTodoCommentText(lines[lineIndex]))).toEqual([
                '### TODO -- REFERENCE ID REQUIRED',
                '### TODO: -- RecordType Options -- Business -- Below is the faker recipe',
                '# TODO hand-written',
                '# TODO: check the length'
            ]);

        });

        it('reads a "# TODO" inside a quoted scalar, a template or its strings as part of the value', () => {

            const valueLines = [
                '    Name: "Fix # TODO later"',
                '    Code__c: \'it\'\'s # TODO\'',
                '    Status__c: ${{ faker.helpers.arrayElement([\'Open\', \'Item # TODO\']) }}',
                '    Stage__c: ${{ random_choice("a \\" # TODO") }}',
                '    Notes__c: O\'Brien # TODO: a comment after a plain value'
            ];

            expect(valueLines.map(valueLine => RecipeCockpitRecipeWriter.readTodoCommentText(valueLine))).toEqual([
                undefined,
                undefined,
                undefined,
                undefined,
                '# TODO: a comment after a plain value'
            ]);
            expect(RecipeCockpitRecipeWriter.readTodoCommentText('    Name: "x" # TODO after a quoted value')).toBe('# TODO after a quoted value');
            expect(RecipeCockpitRecipeWriter.readTodoCommentText('    Name: ${{ x }} # TODO after a template')).toBe('# TODO after a template');
            expect(RecipeCockpitRecipeWriter.readTodoCommentText('    # a note # TODO')).toBeUndefined();

        });

        it('counts a commented-out field once, by its marker, and not the field\'s own TODO under it', () => {

            const recipeText = [
                '- object: Contact',
                '  fields:',
                '    LastName: ${{fake.LastName}}',
                '    AccountId: ### TODO -- REFERENCE ID REQUIRED'
            ].join('\n');
            const commentedOut = RecipeCockpitRecipeWriter.commentOutField(recipeText, 'Contact', 'AccountId', 'not needed');
            expect(commentedOut.isApplied).toBe(true);

            const commentedLines = RecipeCockpitRecipeWriter.splitRecipeLines((commentedOut as { recipeText: string }).recipeText).lines;
            const [contact] = RecipeCockpitRecipeWriter.scanRecipeObjects(commentedLines);

            expect(contact.todoLineIndexes).toHaveLength(1);
            expect(RecipeCockpitRecipeWriter.readTodoCommentText(commentedLines[contact.todoLineIndexes[0]])).toMatch(/^### TODO -- RECIPE COCKPIT -- FIELD COMMENTED OUT -- AccountId/);

        });

        // A RECIPE FROM A CLONED REPOSITORY CONTROLS ITS LINES: ONE CUT SHORT BY A LONE CR OR U+2028 WAS QUADRATIC, 13 s AT 240 KB
        it('reads a long line of "#TODO"s that ends in a lone CR or U+2028 in linear time', () => {

            ['\r', '\u2028'].forEach(lineTerminator => {

                const longLine = '    Name: x' + ' #TODO'.repeat(40000) + lineTerminator;
                const { lines } = RecipeCockpitRecipeWriter.splitRecipeLines(['- object: Account', '  fields:', longLine].join('\n'));
                const startedAt = Date.now();

                const [account] = RecipeCockpitRecipeWriter.scanRecipeObjects(lines);
                const todoText = RecipeCockpitRecipeWriter.readTodoCommentText(lines[2]);

                expect(Date.now() - startedAt).toBeLessThan(1000);
                expect(account.todoLineIndexes).toEqual([2]);
                expect(todoText?.startsWith('#TODO #TODO')).toBe(true);

            });

        });

        it('gives a friend its own TODOs and leaves its parent\'s to the parent', () => {

            const { lines } = RecipeCockpitRecipeWriter.splitRecipeLines([
                '- object: Account',
                '  nickname: Account_NickName',
                '  fields:',
                '    OwnerId: ### TODO -- REFERENCE ID REQUIRED',
                '  friends:',
                '    - object: Contact',
                '      nickname: Contact_NickName',
                '      fields:',
                '        ReportsToId: ### TODO -- REFERENCE ID REQUIRED -- Contact',
                '        ### TODO -- VALIDATION RULE NOT APPLIED -- "Rule" -- why'
            ].join('\n'));

            const [account, contact] = RecipeCockpitRecipeWriter.scanRecipeObjects(lines);

            expect(account.todoLineIndexes).toEqual([3]);
            expect(contact.todoLineIndexes).toEqual([8, 9]);

        });

    });

    describe('the model', () => {

        const parse = (recipeLines: string[]) => RecipeCockpitService.parseRecipeSource(recipeLines.join('\n'));

        it('puts a TODO on the field whose lines hold it, and one on no field on the object', () => {

            const account = parse([
                '- object: Account',
                '  nickname: Account_NickName',
                '  fields:',
                '    Name: ${{fake.Company}}',
                '    Rating__c: ${{ random_choice(\'Hot\') }}',
                '        ### TODO: -- RecordType Options -- Business',
                '        # ${{ random_choice(\'Warm\') }}',
                '    ParentId: ### TODO -- REFERENCE ID REQUIRED',
                '    ### TODO -- VALIDATION RULE NOT APPLIED -- "Rule" -- why'
            ]).get('Account');

            expect(account.fieldEntries.get('Name').todos).toBeUndefined();
            expect(account.fieldEntries.get('Rating__c').todos).toEqual([{ lineNumber: 6, text: '### TODO: -- RecordType Options -- Business', removeLock: 'record-type-options' }]);
            expect(account.fieldEntries.get('ParentId').todos).toEqual([{ lineNumber: 8, text: '### TODO -- REFERENCE ID REQUIRED', removeLock: 'field-value' }]);
            expect(account.todos).toEqual([{ lineNumber: 9, text: '### TODO -- VALIDATION RULE NOT APPLIED -- "Rule" -- why' }]);

        });

        it('keeps an iteration\'s TODOs on the iteration, told apart by its nickname', () => {

            const account = parse([
                '- object: Account',
                '  nickname: Account_NickName',
                '  fields:',
                '    ParentId: ### TODO -- REFERENCE ID REQUIRED -- Account',
                '  friends:',
                '    - object: Account',
                '      nickname: Account_child_NickName',
                '      fields:',
                '        ParentId: Account_NickName',
                '        Phone: ### TODO fill in',
                '        ### TODO on the iteration'
            ]).get('Account');

            expect(todoTextsOf(account.fieldEntries.get('ParentId').todos)).toEqual(['### TODO -- REFERENCE ID REQUIRED -- Account']);
            expect(account.todos).toBeUndefined();
            expect(account.iterations).toHaveLength(1);
            expect(account.iterations[0].fieldEntries.get('ParentId').todos).toBeUndefined();
            expect(account.iterations[0].fieldEntries.get('Phone').todos).toEqual([{ lineNumber: 10, text: '### TODO fill in', removeLock: 'field-value' }]);
            expect(account.iterations[0].todos).toEqual([{ lineNumber: 11, text: '### TODO on the iteration' }]);

        });

        it('lists an indistinct later occurrence\'s TODOs on the first, the one row drawn for both', () => {

            const account = parse([
                '- object: Account',
                '  fields:',
                '    ParentId: ### TODO first',
                '- object: Account',
                '  fields:',
                '    ParentId: ### TODO second',
                '    Other__c: ### TODO only the second has this field'
            ]).get('Account');

            expect(account.hasIndistinctOccurrences).toBe(true);
            expect(account.fieldEntries.get('ParentId').todos).toEqual([{ lineNumber: 3, text: '### TODO first', removeLock: 'indistinct-occurrence' }, { lineNumber: 6, text: '### TODO second', removeLock: 'indistinct-occurrence' }]);
            expect(account.todos).toEqual([{ lineNumber: 7, text: '### TODO only the second has this field', removeLock: 'indistinct-occurrence' }]);

        });

        it('carries the TODOs of the tree workspace\'s recipe on its fields, and none on an object without one', () => {

            const recipe = loadTreeRecipe();
            const account = objectOf(recipe, 'Account');

            // THE ROW DRAWS EACH VALUE, WHICH HOLDS ITS TODO, SO ONLY THE LINE AND WHERE IT SITS IN THE VALUE ARE POSTED (#365)
            expect(fieldOf(account, 'Regions__c')?.todos).toEqual([{ lineNumber: 20, valueStart: 0, valueLength: '### TODO -- NO PICKLIST VALUES'.length, removeLock: 'field-value' }]);
            expect(fieldOf(account, 'ParentId')?.todos).toEqual([{ lineNumber: 21, valueStart: 0, valueLength: '### TODO -- REFERENCE ID REQUIRED'.length, removeLock: 'field-value' }]);
            expect(fieldOf(account, 'Name')).not.toHaveProperty('todos');
            expect(account).not.toHaveProperty('todos');
            expect(objectOf(recipe, 'Lead').fields.some(field => 'todos' in field)).toBe(false);

        });

        it('reads both backends\' real output: the rules not applied on the object, an unwired lookup on its field', () => {

            const snowfakeryRecipe = loadRun(VALIDATION_RULE_WORKSPACE_ROOT, SNOWFAKERY_RUN_FOLDER_NAME);
            const fakerJsRecipe = loadRun(VALIDATION_RULE_WORKSPACE_ROOT, FAKERJS_RUN_FOLDER_NAME);

            const snowfakeryGadgetTodos = todoTextsOf(objectOf(snowfakeryRecipe, 'Gadget__c').todos);
            expect(snowfakeryGadgetTodos).toHaveLength(6);
            snowfakeryGadgetTodos.forEach(todoText => expect(todoText).toMatch(/^### TODO -- VALIDATION RULE NOT APPLIED -- "/));
            expect(fieldOf(objectOf(snowfakeryRecipe, 'Widget__c'), 'Gadget__c')?.todos).toEqual([{ lineNumber: expect.any(Number), valueStart: 0, valueLength: '### TODO -- REFERENCE ID REQUIRED'.length, removeLock: 'field-value' }]);

            // THE NESTED faker-js FRIEND IS WIRED TO ITS PARENT, SO ITS LOOKUP IS NO TODO
            const fakerJsGadgetTodos = todoTextsOf(objectOf(fakerJsRecipe, 'Gadget__c').todos);
            expect(fakerJsGadgetTodos).toHaveLength(4);
            fakerJsGadgetTodos.forEach(todoText => expect(todoText).toMatch(/^### TODO -- VALIDATION RULE NOT APPLIED -- "/));
            expect(fieldOf(objectOf(fakerJsRecipe, 'Widget__c'), 'Gadget__c')).not.toHaveProperty('todos');

        });

        it('posts a field TODO\'s text only when its value does not hold it, and otherwise where the value holds it', () => {

            const value = "${{ x('Fix # TODO list') }}\n### TODO -- RecordType A";

            expect(RecipeCockpitService.buildFieldTodoViewModels([
                { lineNumber: 4, text: '### TODO -- RecordType A' },
                { lineNumber: 5, text: '# TODO hand-written, not in the wrapper value' },
                { lineNumber: 6 }
            ], value)).toEqual([
                { lineNumber: 4, valueStart: value.indexOf('### TODO -- RecordType A'), valueLength: '### TODO -- RecordType A'.length },
                { lineNumber: 5, text: '# TODO hand-written, not in the wrapper value' },
                { lineNumber: 6 }
            ]);

        });

        it('adds nothing to a model whose recipe has no TODO', () => {

            const recipeText = [
                '- object: Lead',
                '  nickname: Lead_NickName',
                '  fields:',
                '    LastName: ${{fake.LastName}}'
            ].join('\n');

            const lead = RecipeCockpitService.parseRecipeSource(recipeText).get('Lead');

            expect(lead).not.toHaveProperty('todos');
            expect(lead.fieldEntries.get('LastName')).toEqual({ lineNumber: 4, valueText: expect.any(String) });

        });

        it('offers each TODO line to open, once, and only lines the model names', () => {

            const recipe = loadRun(VALIDATION_RULE_WORKSPACE_ROOT, SNOWFAKERY_RUN_FOLDER_NAME);
            const gadget = objectOf(recipe, 'Gadget__c');
            const openableSourceKeys = RecipeCockpitService.collectOpenableSourceKeys(recipe);

            (gadget.todos ?? []).forEach(todo => expect(openableSourceKeys).toContain(RecipeCockpitService.buildOpenSourceKey(gadget.recipeFilePath, todo.lineNumber)));
            expect(new Set(openableSourceKeys).size).toBe(openableSourceKeys.length);

        });

    });

    describe('the check', () => {

        it('sits in the filter tile under the Treecipe tab\'s search box, off by default, labelled with the card\'s TODO count (#490)', () => {

            const panel = drawRecipe();
            const accountCard = panel.treeCards()[0];
            const checkElement = checkOf(panel, accountCard);

            expect(checkElement.parentNode.classList.contains('treeTodosCheck')).toBe(true);
            expect(checkElement.parentNode.parentNode.classList.contains('treecipeFilterRow')).toBe(true);
            expect(checkElement.parentNode.parentNode.parentNode.classList.contains('treecipeFilterTile')).toBe(true);
            expect(panel.findAll(panel.findAll(accountCard, 'tabSearch')[0], 'treeTodosToggle')).toHaveLength(0);
            expect(RECIPE_COCKPIT_TODOS_ONLY_LABEL).toBe('Click to show fields with open TODOs');
            expect(checkElement.attributes.role).toBe('checkbox');
            expect(checkElement.attributes['aria-checked']).toBe('false');
            expect(checkElement.disabled).toBe(false);
            expect(labelOf(panel, accountCard).textContent).toBe(`${RECIPE_COCKPIT_TODOS_ONLY_LABEL} (5)`);

            labelOf(panel, accountCard).dispatch('click');
            expect(checkElement.attributes['aria-checked']).toBe('true');
            expect(checkElement.textContent).toBe('✓');

        });

        it('shows only the fields with a TODO, expands their objects and counts each object\'s TODOs', () => {

            const panel = drawRecipe();
            const accountCard = panel.treeCards()[0];

            checkOf(panel, accountCard).dispatch('click');

            const account = objectNamed(panel, accountCard, 'Account');
            const contact = objectNamed(panel, accountCard, 'Contact');

            expect(isObjectExpanded(panel, account)).toBe(true);
            expect(panel.visibleFieldNamesOf(account)).toEqual(['Regions__c', 'ParentId', 'OwnerId']);
            expect(panel.objectCountOf(account)).toBe('3 TODOs');
            expect(panel.visibleFieldNamesOf(contact)).toEqual(['AccountId']);
            expect(panel.objectCountOf(contact)).toBe('1 TODO');
            expect(todoTextsIn(panel, panel.fieldRowNamed(account, 'ParentId'))).toEqual([`${RECIPE_COCKPIT_TODO_IN_VALUE_LABEL} (line 21)`]);

        });

        it('gives back every row and what the reader had opened when it is turned off', () => {

            const panel = drawRecipe();
            const accountCard = panel.treeCards()[0];

            checkOf(panel, accountCard).dispatch('click');
            checkOf(panel, accountCard).dispatch('click');

            const account = objectNamed(panel, accountCard, 'Account');
            expect(isObjectExpanded(panel, account)).toBe(false);
            expect(panel.visibleFieldNamesOf(account).length).toBeGreaterThan(3);
            expect(matchCountOf(panel, accountCard)).toMatch(/^\d+ fields$/);

        });

        it('combines with the search box: a field shows only when it passes both', () => {

            const panel = drawRecipe();
            const accountCard = panel.treeCards()[0];

            checkOf(panel, accountCard).dispatch('click');
            panel.typeIntoFilter('ownerid', accountCard);

            const account = objectNamed(panel, accountCard, 'Account');
            expect(panel.visibleFieldNamesOf(account)).toEqual(['OwnerId']);
            expect(panel.objectCountOf(objectNamed(panel, accountCard, 'Contact'))).toBe('no matching fields');

        });

        it('counts the fields that pass both the check and the search, out of the object\'s fields', () => {

            const panel = drawRecipe();
            const accountCard = panel.treeCards()[0];

            checkOf(panel, accountCard).dispatch('click');
            panel.typeIntoFilter('id', accountCard);

            const account = objectNamed(panel, accountCard, 'Account');
            expect(panel.visibleFieldNamesOf(account)).toEqual(['ParentId', 'OwnerId']);
            expect(panel.objectCountOf(account)).toMatch(/^2 of \d+ fields$/);

        });

        it('opens an object the search names for the TODOs on the object itself, and says how many', () => {

            const panel = drawRecipe(loadRun(VALIDATION_RULE_WORKSPACE_ROOT, SNOWFAKERY_RUN_FOLDER_NAME));
            const card = panel.treeCards()[0];

            checkOf(panel, card).dispatch('click');
            panel.typeIntoFilter('gadget__c', card);

            const gadget = objectNamed(panel, card, 'Gadget__c');
            expect(isObjectExpanded(panel, gadget)).toBe(true);
            expect(panel.objectCountOf(gadget)).toBe('6 TODOs on the object');

        });

        it('combines with "Record type fields only": a field shows only when it is both', () => {

            const panel = drawRecipe();
            const accountCard = panel.treeCards()[0];

            checkOf(panel, accountCard).dispatch('click');
            panel.findAll(panel.tabPanelOf(accountCard, 'treeStructure'), 'treeRecordTypeFieldsToggle')[0].dispatch('click');

            const account = objectNamed(panel, accountCard, 'Account');
            expect(panel.visibleFieldNamesOf(account)).toEqual([]);
            expect(panel.objectCountOf(account)).toBe('no matching fields');
            expect(panel.objectCountOf(objectNamed(panel, accountCard, 'Contact'))).toBe('no record type fields');

        });

        it('draws an iteration\'s own TODOs, and never the first occurrence\'s, on the iteration', () => {

            const recipe = loadTreeRecipe();
            const account = objectOf(recipe, 'Account');
            account.nickname = 'Account_NickName';
            account.iterations = [{
                nickname: 'Account_child_NickName',
                lineNumber: 30,
                parentObjectApiName: 'Account',
                parentNickname: 'Account_NickName',
                fields: [
                    { fieldApiName: 'ParentId', lineNumber: 31, recipeValue: 'Account_NickName' },
                    { fieldApiName: 'Phone', lineNumber: 32, recipeValue: '### TODO call', todos: [{ lineNumber: 32 }] }
                ],
                todos: [{ lineNumber: 33, text: '### TODO on the iteration' }]
            }];
            const accountTree = recipe.trees.find(tree => tree.treeKey === ACCOUNT_TREE_KEY);
            const accountTreeObject = accountTree.objects.find(treeObject => treeObject.objectApiName === 'Account');
            accountTree.objects.splice(1, 0, { ...accountTreeObject, iterationNickname: 'Account_child_NickName' });

            const panel = drawRecipe(recipe);
            const accountCard = panel.treeCards()[0];
            checkOf(panel, accountCard).dispatch('click');

            const iterationElement = panel.findAll(accountCard, 'treeObject')[1];
            expect(panel.visibleFieldNamesOf(iterationElement)).toEqual(['Phone']);
            expect(todoTextsIn(panel, panel.objectBodyOf(iterationElement).children[0])).toEqual(['### TODO on the iteration']);
            expect(panel.objectCountOf(iterationElement)).toBe('2 TODOs');
            expect(labelOf(panel, accountCard).textContent).toBe(`${RECIPE_COCKPIT_TODOS_ONLY_LABEL} (7)`);

        });

        it('never hides an object without a TODO, and says so', () => {

            const recipe = loadTreeRecipe();
            const otherChild = objectOf(recipe, 'OtherChildObject__c');
            otherChild.fields.forEach(field => { delete field.todos; });

            const panel = drawRecipe(recipe);
            const accountCard = panel.treeCards()[0];
            checkOf(panel, accountCard).dispatch('click');

            const otherChildElement = objectNamed(panel, accountCard, 'OtherChildObject__c');
            expect(otherChildElement).toBeDefined();
            expect(isObjectExpanded(panel, otherChildElement)).toBe(false);
            expect(panel.objectCountOf(otherChildElement)).toBe('no TODOs');

        });

        it('draws an object\'s own TODOs at the top of its rows, and opens it for them', () => {

            const panel = drawRecipe(loadRun(VALIDATION_RULE_WORKSPACE_ROOT, SNOWFAKERY_RUN_FOLDER_NAME));
            const card = panel.treeCards()[0];

            checkOf(panel, card).dispatch('click');

            const gadget = objectNamed(panel, card, 'Gadget__c');
            const objectTodoList = panel.objectBodyOf(gadget).children[0];

            expect(isObjectExpanded(panel, gadget)).toBe(true);
            expect(objectTodoList.classList.contains('treeTodos')).toBe(true);
            expect(todoTextsIn(panel, objectTodoList)).toHaveLength(6);
            expect(panel.objectCountOf(gadget)).toBe('6 TODOs');

        });

        it('opens a TODO\'s own line from its link', () => {

            const recipe = loadTreeRecipe();
            const panel = drawRecipe(recipe);
            const accountCard = panel.treeCards()[0];
            checkOf(panel, accountCard).dispatch('click');

            const account = objectNamed(panel, accountCard, 'Account');
            panel.findAll(panel.fieldRowNamed(account, 'OwnerId'), 'treeTodoSource')[0].dispatch('click');

            expect(panel.postedHostMessages).toContainEqual({ command: 'openSource', filePath: objectOf(recipe, 'Account').recipeFilePath, lineNumber: 22 });

        });

        it('is drawn disabled, with why, on a card whose recipe has no TODO', () => {

            const panel = drawRecipe();
            const leadCard = panel.treeCards()[1];

            expect(checkOf(panel, leadCard).disabled).toBe(true);
            expect(checkOf(panel, leadCard).attributes.title).toBe(RECIPE_COCKPIT_NO_TODOS_NOTE);
            expect(labelOf(panel, leadCard).textContent).toBe(RECIPE_COCKPIT_TODOS_ONLY_LABEL);
            expect(panel.findAll(panel.tabPanelOf(leadCard, 'treeStructure'), 'treeTodosNote')[0].textContent).toBe(RECIPE_COCKPIT_NO_TODOS_NOTE);

        });

        it('writes hand-edited TODO text as text, whatever it holds', () => {

            const hostileTexts = ['### TODO <img src=x onerror=alert(1)>', '### TODO [run](command:workbench.action.terminal.new)', '### TODO __proto__', '### TODO constructor'];
            const recipe = loadTreeRecipe();
            const account = objectOf(recipe, 'Account');
            account.todos = hostileTexts.map((text, todoIndex) => ({ lineNumber: 7 + todoIndex, text: text }));

            const panel = drawRecipe(recipe);
            const accountCard = panel.treeCards()[0];
            checkOf(panel, accountCard).dispatch('click');

            const accountElement = objectNamed(panel, accountCard, 'Account');
            expect(todoTextsIn(panel, panel.objectBodyOf(accountElement).children[0])).toEqual(hostileTexts);
            panel.findAll(accountElement, 'treeTodoText').forEach((todoElement: any) => expect(todoElement.children).toHaveLength(0));
            expect(labelOf(panel, accountCard).textContent).toBe(`${RECIPE_COCKPIT_TODOS_ONLY_LABEL} (9)`);

        });

    });

    describe('the saved place', () => {

        const savedTreeOf = (panel: Panel) => panel.savedState().trees.find((savedTree: any) => savedTree.treeKey === ACCOUNT_TREE_KEY);

        const savedPlaceWith = (treePlace: Record<string, unknown>) => ({
            version: RECIPE_COCKPIT_PANEL_PLACE_VERSION,
            runFolderName: TREE_RUN_FOLDER_NAME,
            isOrgPickerInUse: false,
            isFavoritesOnly: false,
            scrollY: 0,
            trees: [{ treeKey: ACCOUNT_TREE_KEY, isExpanded: true, selectedTab: 'treecipe', searchQueries: { treecipe: '', datasets: '' }, expandedObjectKeys: [], openPicklistKeys: [], ...treePlace }]
        });

        it('saves the check as an optional field of the card, and drops it once it is off', () => {

            const panel = drawRecipe();

            checkOf(panel, panel.treeCards()[0]).dispatch('click');
            expect(panel.savedState().version).toBe(RECIPE_COCKPIT_PANEL_PLACE_VERSION);
            expect(savedTreeOf(panel).isTodosOnly).toBe(true);

            checkOf(panel, panel.treeCards()[0]).dispatch('click');
            // A CARD BACK AT ITS DEFAULT IS NOT WRITTEN AT ALL (#374)
            expect(savedTreeOf(panel) ?? {}).not.toHaveProperty('isTodosOnly');

        });

        it('restores the check and its filter in the next document', () => {

            const firstPanel = drawRecipe();
            checkOf(firstPanel, firstPanel.treeCards()[0]).dispatch('click');

            const panel = runPanelScript({ savedState: firstPanel.savedState() });
            panel.postToPanel({ command: 'recipeData', recipe: loadTreeRecipe(), renderSequence: 3 });

            const accountCard = panel.treeCards()[0];
            expect(checkOf(panel, accountCard).attributes['aria-checked']).toBe('true');
            expect(panel.visibleFieldNamesOf(objectNamed(panel, accountCard, 'Account'))).toEqual(['Regions__c', 'ParentId', 'OwnerId']);

        });

        it('loads an older place, which has no such field, with the check off', () => {

            const panel = runPanelScript({ savedState: savedPlaceWith({}) });
            panel.postToPanel({ command: 'recipeData', recipe: loadTreeRecipe(), renderSequence: 3 });

            expect(checkOf(panel, panel.treeCards()[0]).attributes['aria-checked']).toBe('false');

        });

        it('keeps the field through normalizePanelPlace only when it is true', () => {

            const normalizedTree = (isTodosOnly: unknown) => RecipeCockpitService.normalizePanelPlace(savedPlaceWith({ isTodosOnly }))?.trees[0];

            expect(normalizedTree(true)?.isTodosOnly).toBe(true);
            [false, 'true', 1, null, undefined].forEach(candidateValue => expect(normalizedTree(candidateValue)).not.toHaveProperty('isTodosOnly'));

        });

    });

});
