import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { SnowfakeryRecipeProcessor } from '../SnowfakeryRecipeProcessor';

/*
    jest hands a test a COPY of process.env, while the real child_process spawns with the real one,
    so the stand-in snowfakery this suite puts on PATH would be invisible to the child. The wrapper
    forwards the test's env and nothing else: the command, the argv and every option the processor
    chose reach the real execFile as they were passed.
*/
jest.mock('child_process', () => {
    const actualChildProcess = jest.requireActual('child_process');
    return {
        ...actualChildProcess,
        execFile: (command: string, args: string[], options: object, callback: (...callbackArgs: unknown[]) => void) =>
            actualChildProcess.execFile(command, args, { ...options, env: process.env }, callback)
    };
});

jest.mock('vscode', () => ({
    window: {
      showInformationMessage: jest.fn()
    },
    workspace: {
      workspaceFolders: jest.fn()
    }
}), { virtual: true });

/*
    The mocked child_process in SnowfakeryRecipeProcessor.test.ts proves the argv the processor
    builds. This suite proves what that argv DOES: a real process is spawned against a stand-in
    snowfakery on PATH that echoes its arguments back, so a shell interpreting the file name would
    either create the marker file or change the argument count.
*/
const describeOnPosix = process.platform === 'win32' ? describe.skip : describe;

describeOnPosix('SnowfakeryRecipeProcessor.generateFakeDataBySelectedRecipeFile against a real process', () => {

    let sandboxDirectoryPath: string;
    let originalPath: string | undefined;

    beforeEach(() => {

        sandboxDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-snowfakery-'));

        const fakeSnowfakeryPath = path.join(sandboxDirectoryPath, 'snowfakery');
        fs.writeFileSync(
            fakeSnowfakeryPath,
            `#!${ process.execPath }\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n`,
            { mode: 0o755 }
        );

        originalPath = process.env.PATH;
        process.env.PATH = `${ sandboxDirectoryPath }${ path.delimiter }${ originalPath ?? '' }`;

    });

    afterEach(() => {

        process.env.PATH = originalPath;
        fs.rmSync(sandboxDirectoryPath, { recursive: true, force: true });

    });

    test.each([
        ['backticks', (markerPath: string) => `a\`touch ${ markerPath }\`.yaml`],
        ['command substitution', (markerPath: string) => `a$(touch ${ markerPath }).yaml`],
        ['a command separator', (markerPath: string) => `a; touch ${ markerPath } ;.yaml`],
        ['a conditional chain', (markerPath: string) => `a && touch ${ markerPath } && b.yaml`],
        ['a space', (_markerPath: string) => 'my recipe.yaml']
    ])('passes a recipe file name containing %s as one literal argument without shell interpretation', async (_description, buildRecipeFileName) => {

        const markerPath = path.join(sandboxDirectoryPath, 'pwned');
        const recipeFilePath = path.join(sandboxDirectoryPath, 'some dir', buildRecipeFileName(markerPath));

        const snowfakeryStandardOut = await new SnowfakeryRecipeProcessor().generateFakeDataBySelectedRecipeFile(recipeFilePath);

        expect(JSON.parse(snowfakeryStandardOut as string)).toEqual([recipeFilePath, '--output-format', 'json']);
        expect(fs.existsSync(markerPath)).toBe(false);

    });

});
