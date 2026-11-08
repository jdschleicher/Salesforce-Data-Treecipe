import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import { RecordTypeSelectionConfiguration } from '../RecordTypeSelectionConfiguration';

jest.mock('vscode', () => ({
    workspace: {
        workspaceFolders: undefined,
        getConfiguration: jest.fn(() => ({
            get: jest.fn((key) => {
                const mockConfig = {
                    selectedFakerService: 'snowfakery', // Replace with mock key-value pairs as needed
                };
                return mockConfig[key];
            }),
            // update RETURNS A THENABLE, AND VS CODE REJECTS IT WHEN THERE IS NO WORKSPACE TO WRITE TO
            update: jest.fn().mockResolvedValue(undefined),
            // NO SETTING AT ANY SCOPE
            inspect: jest.fn(() => undefined),
        })),
    },
    Uri: {
        file: (path: string) => ({ fsPath: path })
    },
    window: {
        showErrorMessage: jest.fn(),
        showWarningMessage: jest.fn(),
        showQuickPick: jest.fn()
    },
    ConfigurationTarget: { Workspace: 2 },
    ThemeIcon: jest.fn().mockImplementation(
        (name) => ({ id: name })
    )

}), { virtual: true });

describe('saved record type selections (#196)', () => {

    let sandboxDirectoryPath: string;
    let configurationFilePath: string;

    const writeConfiguration = (configurationDetail: unknown) => fs.writeFileSync(configurationFilePath, JSON.stringify(configurationDetail, null, 4));
    const readConfiguration = () => JSON.parse(fs.readFileSync(configurationFilePath, 'utf-8'));

    beforeEach(() => {
        sandboxDirectoryPath = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-record-type-selections-')));
        configurationFilePath = path.join(sandboxDirectoryPath, 'treecipe.config.json');
        jest.spyOn(ConfigurationService, 'resolveTreecipeConfigurationFilePath').mockReturnValue({ configurationFilePath: configurationFilePath });
        (vscode.window.showWarningMessage as jest.Mock).mockClear();
        (RecordTypeSelectionConfiguration as any).shownRecordTypeSelectionWarnings.clear();
    });

    afterEach(() => {
        fs.rmSync(sandboxDirectoryPath, { recursive: true, force: true });
    });

    describe('readSavedRecordTypeSelection', () => {

        test('given no saved selection, answers undefined and warns about nothing', () => {

            writeConfiguration({ salesforceObjectsPath: './force-app/main/default/objects/', dataFakerService: 'faker-js' });

            expect(RecordTypeSelectionConfiguration.readSavedRecordTypeSelection()).toBeUndefined();
            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();

        });

        test('given a saved selection, answers it with the record types it was saved against', () => {

            writeConfiguration({
                salesforceObjectsPath: './force-app/main/default/objects/',
                recordTypeSelections: { Account: ['Partner', 'Customer'] },
                recordTypesWhenSelectionSaved: { Account: ['Customer', 'Partner'] }
            });

            const savedSelection = RecordTypeSelectionConfiguration.readSavedRecordTypeSelection();

            expect(savedSelection?.getDeveloperNames('Account')).toEqual(['Partner', 'Customer']);
            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();

        });

        test('given an unusable entry, ignores it with ONE warning per session and keeps the rest', () => {

            writeConfiguration({ recordTypeSelections: { Account: 'Partner', Contact: ['Vendor'] } });

            expect(RecordTypeSelectionConfiguration.readSavedRecordTypeSelection()?.getDeveloperNames('Contact')).toEqual(['Vendor']);
            expect(RecordTypeSelectionConfiguration.readSavedRecordTypeSelection()?.getDeveloperNames('Account')).toBeUndefined();

            expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls[0][0]).toContain('"recordTypeSelections" entry "Account"');

        });

        test.each([
            ['a list', []],
            ['null', null],
            ['a string', 'config']
        ])('given a config that parses as %s, answers undefined rather than throwing', (unusedDescription, configurationDetail) => {

            writeConfiguration(configurationDetail);

            expect(RecordTypeSelectionConfiguration.readSavedRecordTypeSelection()).toBeUndefined();

        });

    });

    describe('saveRecordTypeSelections', () => {

        test('writes the selection and the record types each object had, keeping every other key', () => {

            writeConfiguration({ salesforceObjectsPath: './objects/', dataFakerService: 'snowfakery', customCompoundAddressFields: ['Home__c'] });

            const writtenPath = RecordTypeSelectionConfiguration.saveRecordTypeSelections(
                { Account: ['Partner', 'Customer'] },
                { Account: ['Customer', 'Partner'], Contact: ['Vendor'] }
            );

            expect(writtenPath).toBe(configurationFilePath);
            expect(readConfiguration()).toEqual({
                salesforceObjectsPath: './objects/',
                dataFakerService: 'snowfakery',
                customCompoundAddressFields: ['Home__c'],
                recordTypeSelections: { Account: ['Partner', 'Customer'] },
                recordTypesWhenSelectionSaved: { Account: ['Customer', 'Partner'] }
            });
            expect(RecordTypeSelectionConfiguration.readSavedRecordTypeSelection()?.getDeveloperNames('Account')).toEqual(['Partner', 'Customer']);

        });

        test('replaces a saved selection rather than merging into it', () => {

            writeConfiguration({ recordTypeSelections: { Contact: ['Vendor'] }, recordTypesWhenSelectionSaved: { Contact: ['Vendor', 'Employee'] } });

            RecordTypeSelectionConfiguration.saveRecordTypeSelections({ Account: ['Partner'] }, { Account: ['Partner', 'Customer'] });

            expect(readConfiguration()).toEqual({ recordTypeSelections: { Account: ['Partner'] }, recordTypesWhenSelectionSaved: { Account: ['Partner', 'Customer'] } });

        });

        test('given an empty selection, as Use defaults remembers, removes both keys', () => {

            writeConfiguration({ dataFakerService: 'faker-js', recordTypeSelections: { Account: ['Partner'] }, recordTypesWhenSelectionSaved: { Account: ['Partner'] } });

            RecordTypeSelectionConfiguration.saveRecordTypeSelections({}, {});

            expect(readConfiguration()).toEqual({ dataFakerService: 'faker-js' });

        });

        test('given a config that is not a JSON object, throws and writes nothing', () => {

            writeConfiguration(['not', 'an', 'object']);

            expect(() => RecordTypeSelectionConfiguration.saveRecordTypeSelections({ Account: ['Partner'] }, {})).toThrow('not a JSON object');
            expect(readConfiguration()).toEqual(['not', 'an', 'object']);

        });

    });

});
