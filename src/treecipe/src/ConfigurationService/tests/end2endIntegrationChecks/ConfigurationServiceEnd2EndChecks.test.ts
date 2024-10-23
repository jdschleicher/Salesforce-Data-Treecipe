import { ConfigurationService } from "../../ConfigurationService";
import * as fs from 'fs';
import * as vscode from 'vscode';

// create configuration .treecipe directory 
// create .treecipe.config.json file inside treecipe directory 
// create timestamped directory for treecipe generation
// recipe yaml file created matches expected markup

// 

jest.mock('vscode', () => ({
    workspace: {
        workspaceFolders: undefined
    },
    Uri: {
        file: (path: string) => ({ fsPath: path })
    }
  }), { virtual: true });

describe('createConfigurationFile', () => {
  
    beforeEach(() => {
      jest.clearAllMocks();
    });
  
    test('given a vscode workspace root directory, a dedicated extension directory is created with base config file', () => {
    
  
      const mockFsPath = '/mock/workspace/path';
      const mockWorkspaceFolders = [{
        uri: { 
          fsPath: mockFsPath,
          scheme: "test",
          authority: "",
          path: "",
          query: "",
          fragment: "",
          toJSON: null,
          with: null
         },
        name: 'mockWorkspace',
        index: 0
      }];
    
      // jest.spyOn(vscode.workspace, 'workspaceFolders', 'get')
      //   .mockReturnValue(mockWorkspaceFolders);
  
      // Mocking workspaceFolders as a getter
      Object.defineProperty(vscode.workspace, 'workspaceFolders', {
        get: jest.fn(() => mockWorkspaceFolders),
      });
  
      const expectedNewDirectory = ".treecipe";
      const expectedFileName = ".treecipe.config.json";
  
      const expectedConfigJson = 
  `{
      "salesforceObjectsPath": ""
  }`;
  
      const expectedFieldPath = `${expectedNewDirectory}/${expectedFileName}`;
  
      ConfigurationService.createConfigurationFile();
      const createdFileContent = fs.readFileSync(expectedFieldPath, 'utf-8');
  
      expect(createdFileContent).toBe(expectedConfigJson);
  
    });
  
  });
