import * as fs from 'fs';
import * as path from 'path';
import { ErrorHandlingService } from '../ErrorHandlingService';

jest.mock('vscode', () => ({}), { virtual: true });

/*
    Missing-config recovery re-runs the original command by the id commandIdByCommandName gives
    its commandName (#101). A command name with no entry silently loses that re-run, so every name
    a caller passes to handleCapturedError is read from the source and held to the map here.
*/
const repositoryRoot = path.resolve(__dirname, '../../../../..');
const servicesRoot = path.join(repositoryRoot, 'src', 'treecipe', 'src');
const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf-8'));
const declaredCommandIds: string[] = packageJson.contributes.commands.map((declaredCommand: { command: string }) => declaredCommand.command);

function listServiceSourceFiles(directoryPath: string): string[] {
    return fs.readdirSync(directoryPath, { withFileTypes: true }).flatMap(directoryEntry => {
        const entryPath = path.join(directoryPath, directoryEntry.name);
        if (directoryEntry.isDirectory()) {
            return directoryEntry.name === 'tests' ? [] : listServiceSourceFiles(entryPath);
        }
        return entryPath.endsWith('.ts') ? [entryPath] : [];
    });
}

const handleCapturedErrorCall = /ErrorHandlingService\.handleCapturedError\(\s*[\w.]+\s*,\s*([^)]*?)\s*\)/g;
// EVERY MENTION OF handleCapturedError( BUT ITS OWN DECLARATION, SO A CALL SHAPED UNLIKE handleCapturedErrorCall FAILS INSTEAD OF BEING SKIPPED
const anyHandleCapturedErrorCall = /(?<!static )\bhandleCapturedError\b['"`]?\]?\s*\(/g;
const commandNameDeclaration = /const commandName = '(\w+)';/g;
const anyCommandNameDeclaration = /\b(?:const|let|var)\s+commandName\b/g;

function findCapturedCommandNames(): { commandNames: Set<string>; unreadableArguments: string[] } {

    const commandNames = new Set<string>();
    const unreadableArguments: string[] = [];
    const sourceFilePaths = [...listServiceSourceFiles(servicesRoot), path.join(repositoryRoot, 'src', 'extension.ts')];

    for (const sourceFilePath of sourceFilePaths) {
        const sourceText = fs.readFileSync(sourceFilePath, 'utf-8');
        const relativeSourcePath = path.relative(repositoryRoot, sourceFilePath);
        const readableCallCount = [...sourceText.matchAll(handleCapturedErrorCall)].length;
        const callCount = [...sourceText.matchAll(anyHandleCapturedErrorCall)].length;
        if (readableCallCount !== callCount) {
            unreadableArguments.push(`${relativeSourcePath}: ${callCount - readableCallCount} handleCapturedError call(s) not written as ErrorHandlingService.handleCapturedError(error, 'name' | commandName)`);
        }
        const literalDeclarationCount = [...sourceText.matchAll(commandNameDeclaration)].length;
        const declarationCount = [...sourceText.matchAll(anyCommandNameDeclaration)].length;
        if (literalDeclarationCount !== declarationCount) {
            unreadableArguments.push(`${relativeSourcePath}: ${declarationCount - literalDeclarationCount} commandName declaration(s) not written as const commandName = '<name>';`);
        }
        for (const [, commandNameArgument] of sourceText.matchAll(handleCapturedErrorCall)) {
            const literalCommandName = /^'(\w+)'$/.exec(commandNameArgument);
            if (literalCommandName) {
                commandNames.add(literalCommandName[1]);
            } else if (commandNameArgument !== 'commandName') {
                unreadableArguments.push(`${relativeSourcePath}: ${commandNameArgument}`);
            }
        }
        for (const [, declaredCommandName] of sourceText.matchAll(commandNameDeclaration)) {
            commandNames.add(declaredCommandName);
        }
    }

    return { commandNames, unreadableArguments };
}

describe('ErrorHandlingService.commandIdByCommandName (#101)', () => {

    const { commandNames, unreadableArguments } = findCapturedCommandNames();

    it('reads every handleCapturedError command name as a literal or a const commandName', () => {
        expect(unreadableArguments).toEqual([]);
        expect(commandNames.size).toBeGreaterThanOrEqual(10);
    });

    it.each([...commandNames].sort())('maps %s to a command package.json declares', (commandName) => {
        expect(Object.prototype.hasOwnProperty.call(ErrorHandlingService.commandIdByCommandName, commandName)).toBe(true);
        expect(declaredCommandIds).toContain(ErrorHandlingService.commandIdByCommandName[commandName]);
    });

    it('holds no entry that no caller passes, and every id is declared', () => {
        expect(Object.keys(ErrorHandlingService.commandIdByCommandName).sort()).toEqual([...commandNames].sort());
        for (const commandId of Object.values(ErrorHandlingService.commandIdByCommandName)) {
            expect(declaredCommandIds).toContain(commandId);
        }
    });

    it('maps the setup command to the id the recovery runs, and has no prototype', () => {
        expect(ErrorHandlingService.commandIdByCommandName.initiateTreecipeConfigurationSetup).toBe(ErrorHandlingService.initiateConfigurationCommandId);
        expect(Object.getPrototypeOf(ErrorHandlingService.commandIdByCommandName)).toBeNull();
        expect(Object.isFrozen(ErrorHandlingService.commandIdByCommandName)).toBe(true);
    });

});
