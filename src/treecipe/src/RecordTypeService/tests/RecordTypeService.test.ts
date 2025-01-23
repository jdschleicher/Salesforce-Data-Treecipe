import { RecordTypeService } from "../../RecordTypeService/RecordTypeService";

jest.mock('vscode', () => ({
    workspace: {
        workspaceFolders: undefined
    },
    Uri: {
        file: (path: string) => ({ fsPath: path })
    }
}), { virtual: true });


describe('RecordTypeService Shared Intstance Tests', () => {

   

});
